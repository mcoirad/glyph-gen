const draw = SVG().addTo("#canvas").size(600, 600);

const DEFAULT_SIZE = 60;

class GlyphPrimitive {
  constructor(type, options = {}) {
    this.type = type;
    this.points = options.points || [];
    this.segments = options.segments || [];
    this.edges = options.edges || [];
    this.visible = options.visible !== false;
    this.transform = {
      rotate: 0,
      center: [0, 0],
      translate: [0, 0],
      scale: [1, 1]
    };

    if ((type === "arcCircle" || type === "starburst") && this.edges.length) {
      for (let i = 0; i < this.edges.length && i < this.segments.length; i += 1) {
        this.segments[i].visible = this.edges[i] !== false;
      }
    }
  }

  rotate(angle, cx = 0, cy = 0) {
    this.transform.rotate += angle;
    this.transform.center = [cx, cy];
  }

  translate(dx, dy) {
    this.transform.translate[0] += dx;
    this.transform.translate[1] += dy;
  }

  scale(sx, sy) {
    this.transform.scale[0] *= sx;
    this.transform.scale[1] *= sy;
  }

  hideEdge(index) {
    if (this.type === "polygon" && index < this.edges.length) {
      this.edges[index] = false;
    } else if ((this.type === "arcCircle" || this.type === "starburst") && index < this.segments.length) {
      this.segments[index].visible = false;
      this.edges[index] = false;
    }
  }

  clone() {
    const copy = new GlyphPrimitive(this.type, {
      points: JSON.parse(JSON.stringify(this.points)),
      segments: JSON.parse(JSON.stringify(this.segments)),
      edges: [...this.edges],
      visible: this.visible
    });
    copy.transform = JSON.parse(JSON.stringify(this.transform));
    return copy;
  }

  render(group) {
    const g = group.group();
    g.translate(this.transform.translate[0], this.transform.translate[1]);
    g.scale(this.transform.scale[0], this.transform.scale[1]);
    g.rotate(this.transform.rotate, this.transform.center[0], this.transform.center[1]);

    if (!this.visible) {
      return;
    }

    const strokeAttrs = { width: 2, color: "#000" };

    if (this.type === "polygon") {
      for (let i = 0; i < this.points.length; i += 1) {
        const p1 = this.points[i];
        const p2 = this.points[(i + 1) % this.points.length];
        const visible = this.edges[i] !== false;
        g.line(p1[0], p1[1], p2[0], p2[1])
          .stroke({ width: 2, color: visible ? "#000" : "transparent" })
          .attr({ "vector-effect": "non-scaling-stroke" });
      }
    }

    if (this.type === "lines") {
      this.segments.forEach(([p1, p2]) => {
        g.line(p1[0], p1[1], p2[0], p2[1])
          .stroke(strokeAttrs)
          .attr({ "vector-effect": "non-scaling-stroke" });
      });
    }

    if (this.type === "arcCircle") {
      this.segments.forEach((seg) => {
        if (!seg.visible) {
          return;
        }
        const [x1, y1] = seg.start;
        const [x2, y2] = seg.end;
        const r = Math.hypot(x1, y1);
        const path = `M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`;
        g.path(path)
          .fill("none")
          .stroke(strokeAttrs)
          .attr({ "vector-effect": "non-scaling-stroke" });
      });
    }

    if (this.type === "starburst") {
      this.segments.forEach((seg) => {
        if (!seg.visible) {
          return;
        }
        const [x1, y1] = seg.start;
        const [x2, y2] = seg.end;
        g.line(x1, y1, x2, y2)
          .stroke(strokeAttrs)
          .attr({ "vector-effect": "non-scaling-stroke" });
      });
    }
  }
}

function createStarburst(n = 8, radius = 30) {
  const angleStep = (Math.PI * 2) / n;
  const segments = [];
  for (let i = 0; i < n; i += 1) {
    const angle = i * angleStep;
    segments.push({
      start: [0, 0],
      end: [Math.cos(angle) * radius, Math.sin(angle) * radius],
      visible: true
    });
  }
  return new GlyphPrimitive("starburst", { segments });
}

class GlyphComposite {
  constructor(cells = [], layout = "rows", targetWidth = DEFAULT_SIZE, targetHeight = DEFAULT_SIZE) {
    this.cells = cells;
    this.layout = layout;
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;
    this.skipAutoScale = false;
  }

  getBBox(primitive) {
    const dummy = SVG().size(0, 0).group();
    const g = dummy.group();
    primitive.render(g);
    const bbox = g.bbox();
    dummy.remove();
    return bbox;
  }

  stackGrid() {
    if (this.layout === "overlay") {
      return;
    }

    const matrix = this.layout === "cols" ? this.transpose(this.cells) : this.cells;
    const bboxes = matrix.map((row) => row.map((primitive) => this.getBBox(primitive)));
    const rowHeights = bboxes.map((row) => Math.max(...row.map((bbox) => bbox.height)));
    const colWidths = [];
    const numCols = Math.max(...bboxes.map((row) => row.length));

    for (let col = 0; col < numCols; col += 1) {
      colWidths[col] = Math.max(...bboxes.map((row) => (row[col] ? row[col].width : 0)));
    }

    const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const offsetY = -totalHeight / 2;
    let cursorY = offsetY;

    for (let rowIdx = 0; rowIdx < matrix.length; rowIdx += 1) {
      const row = matrix[rowIdx];
      const height = rowHeights[rowIdx];
      let cursorX = -totalWidth / 2;

      for (let colIdx = 0; colIdx < row.length; colIdx += 1) {
        const primitive = row[colIdx];
        const width = colWidths[colIdx];
        if (primitive instanceof GlyphPrimitive || primitive instanceof GlyphComposite) {
          if (primitive instanceof GlyphComposite) {
            primitive.targetWidth = width;
            primitive.targetHeight = height;
            primitive.skipAutoScale = true;
            primitive.stackGrid();
          }
          primitive.translate(cursorX + width / 2, cursorY + height / 2);
        }
        cursorX += width;
      }
      cursorY += height;
    }
  }

  transpose(matrix) {
    return matrix[0].map((_, index) => matrix.map((row) => row[index]));
  }

  translate(dx, dy) {
    for (const row of this.cells) {
      for (const primitive of row) {
        if (primitive instanceof GlyphPrimitive || primitive instanceof GlyphComposite) {
          primitive.translate(dx, dy);
        }
      }
    }
  }

  render(group) {
    const g = group.group();

    if (this.layout === "overlay") {
      this.cells.flat().forEach((primitive) => {
        const cellGroup = g.group();
        primitive.render(cellGroup);
      });
    } else {
      this.stackGrid();
      this.cells.forEach((row) => {
        row.forEach((primitive) => {
          const cellGroup = g.group();
          primitive.render(cellGroup);
        });
      });
    }

    if (!this.skipAutoScale) {
      const bbox = g.bbox();
      const scaleX = this.targetWidth / bbox.width;
      const scaleY = this.targetHeight / bbox.height;
      const scale = Math.min(scaleX, scaleY);

      g.scale(scale);
      g.translate(-bbox.cx * scale + this.targetWidth / 2, -bbox.cy * scale + this.targetHeight / 2);
    }

    return g;
  }
}

function createPrimitiveFromSpec(spec) {
  if (spec.type === "polygon" && spec.shape === "square") {
    const halfW = spec.width / 2;
    const halfH = spec.height / 2;
    const edges = [true, true, true, true];
    if (spec.hiddenEdges) {
      for (const index of spec.hiddenEdges) {
        edges[index] = false;
      }
    }
    const primitive = new GlyphPrimitive("polygon", {
      points: [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH]
      ],
      edges
    });
    if (spec.rotate) {
      primitive.rotate(spec.rotate, 0, 0);
    }
    return primitive;
  }

  if (spec.type === "polygon" && spec.shape === "triangle") {
    const halfW = spec.width / 2;
    const halfH = spec.height / 2;
    const edges = [true, true, true];
    if (spec.hiddenEdges) {
      for (const index of spec.hiddenEdges) {
        edges[index] = false;
      }
    }
    const primitive = new GlyphPrimitive("polygon", {
      points: [
        [0, -halfH],
        [halfW, halfH],
        [-halfW, halfH]
      ],
      edges
    });
    if (spec.rotate) {
      primitive.rotate(spec.rotate, 0, 0);
    }
    return primitive;
  }

  if (spec.type === "arcCircle") {
    const radius = spec.radius || DEFAULT_SIZE / 2;
    const segments = [
      { start: [0, -radius], end: [radius, 0], visible: true },
      { start: [radius, 0], end: [0, radius], visible: true },
      { start: [0, radius], end: [-radius, 0], visible: true },
      { start: [-radius, 0], end: [0, -radius], visible: true }
    ];
    const edges = segments.map(() => true);
    if (spec.hiddenEdges) {
      for (const index of spec.hiddenEdges) {
        edges[index] = false;
      }
    }
    return new GlyphPrimitive("arcCircle", { segments, edges });
  }

  if (spec.type === "starburst") {
    const radius = spec.radius || DEFAULT_SIZE / 2;
    const count = spec.points || 4;
    const segments = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i * 2 * Math.PI) / count - (0.5 * Math.PI);
      segments.push({
        start: [0, 0],
        end: [Math.cos(angle) * radius, Math.sin(angle) * radius],
        visible: true
      });
    }
    const edges = segments.map(() => true);
    if (spec.hiddenEdges) {
      for (const index of spec.hiddenEdges) {
        edges[index] = false;
      }
    }
    const primitive = new GlyphPrimitive("starburst", { segments, edges });
    if (spec.rotate) {
      primitive.rotate(spec.rotate, 0, 0);
    }
    return primitive;
  }

  console.warn("Unknown primitive spec:", spec);
  return new GlyphPrimitive("polygon", {});
}

function bitmaskToHiddenEdges(bitmask, edgeCount) {
  const hidden = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const bit = (bitmask >> i) & 1;
    if (!bit) {
      hidden.push(i);
    }
  }
  return hidden;
}

function createPrimitiveFromSymbol(token) {
  const match = token.match(/^([TSCR])(\d+)?(?:r(-?\d+))?$/);
  if (!match) {
    return null;
  }

  const symbol = match[1];
  const bits = match[2] ? parseInt(match[2], 10) : null;
  const rotate = match[3] ? parseInt(match[3], 10) : null;
  const base = {
    hiddenEdges: bits !== null ? bitmaskToHiddenEdges(bits, {
      T: 3,
      S: 8,
      C: 4,
      R: 4
    }[symbol]) : [],
    rotate
  };

  switch (symbol) {
    case "T":
      return createPrimitiveFromSpec({
        type: "polygon",
        shape: "triangle",
        width: DEFAULT_SIZE,
        height: DEFAULT_SIZE,
        ...base
      });
    case "S":
      return createPrimitiveFromSpec({
        type: "starburst",
        points: 8,
        radius: DEFAULT_SIZE / 2,
        ...base
      });
    case "C":
      return createPrimitiveFromSpec({
        type: "arcCircle",
        radius: DEFAULT_SIZE / 2,
        ...base
      });
    case "R":
      return createPrimitiveFromSpec({
        type: "polygon",
        shape: "square",
        width: DEFAULT_SIZE,
        height: DEFAULT_SIZE,
        ...base
      });
    default:
      console.warn("Unhandled symbol:", symbol);
      return null;
  }
}

function tokenizeLSystem(input) {
  const regex = /[TSCR]\d*(r-?\d+)?|[-*|\[\]]/g;
  return input.match(regex) || [];
}

function isPrimitive(token) {
  return /^[TSCR]\d*(r-?\d+)?$/.test(token);
}

function parseGlyphLSystem(input) {
  const tokens = tokenizeLSystem(input);
  let index = 0;

  function parseExpression() {
    const rows = [];
    let currentRow = [];
    let currentOp = "rows";

    while (index < tokens.length) {
      const token = tokens[index];
      index += 1;

      if (isPrimitive(token)) {
        currentRow.push(createPrimitiveFromSymbol(token));
      } else if (token === "-") {
        currentOp = "rows";
      } else if (token === "*") {
        currentOp = "overlay";
      } else if (token === "|") {
        if (currentRow.length > 0) {
          rows.push(currentRow);
          currentRow = [];
        }
      } else if (token === "[") {
        currentRow.push(parseExpression());
      } else if (token === "]") {
        break;
      } else {
        console.warn("Unknown token:", token);
      }
    }

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    if (rows.length === 1 && rows[0].length === 1) {
      return new GlyphComposite([[rows[0][0]]], "rows", DEFAULT_SIZE, DEFAULT_SIZE);
    }

    return new GlyphComposite(rows, currentOp, DEFAULT_SIZE, DEFAULT_SIZE);
  }

  return parseExpression();
}

const phoenicianGlyphs = {
  aleph: "T5r270*S17",
  bet: "Tr270|R6",
  giml: "T3r270|R2",
  delat: "T",
  he: "R3|R3|R3|R3",
  waw: "S146",
  tet: "C*S170",
  zayin: "R5*S17",
  het: "R12R6|R13R7|R13R7|R9R3",
  yod: "R3|R3R4",
  kap: "S177|S1",
  lamed: "S17|S3",
  mem: "T5r180 T5r180 R8 | R0 R0 R8 | R0 R0 R8",
  nun: "T5r180 R8 | R0 R8 | R0 R8",
  samekh: "R3R9|R3R9|R3R9|R3R9",
  ayin: "C",
  pe: "C3",
  sade: "S19S130",
  qop: "[C*S17]|S1",
  res: "Tr270|R2",
  shin: "T5r180T5r180",
  taw: "S170"
};

function renderGlyphTable() {
  const cellSize = 60;
  const spacing = 30;
  const labelHeight = 20;
  const effectiveSize = cellSize + spacing + labelHeight;
  const perRow = 6;
  const entries = Object.entries(phoenicianGlyphs);
  const rows = Math.ceil(entries.length / perRow);
  const width = perRow * (cellSize + spacing);
  const height = rows * effectiveSize + 20;

  draw.size(width, height);

  entries.forEach(([name, definition], index) => {
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    const gx = col * (cellSize + spacing) + cellSize / 2;
    const gy = row * effectiveSize + cellSize / 2;
    const glyph = parseGlyphLSystem(definition);

    glyph.render(draw.group().translate(gx, gy));
    draw.text(name)
      .font({ size: 14, family: "IBM Plex Mono, monospace", anchor: "middle" })
      .center(gx, gy + cellSize + 10);
  });
}

renderGlyphTable();
