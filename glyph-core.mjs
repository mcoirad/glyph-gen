export const DEFAULT_SIZE = 60;

const HALF_DEFAULT_SIZE = DEFAULT_SIZE / 2;
const SAMPLE_STEPS = 24;
const EPSILON = 1e-6;

function approxEqual(a, b) {
  return Math.abs(a - b) < EPSILON;
}

function approxZero(value) {
  return Math.abs(value) < EPSILON;
}

function clonePoint([x, y]) {
  return [x, y];
}

function cloneSegment(segment) {
  if (segment.kind === "line") {
    return {
      kind: "line",
      start: clonePoint(segment.start),
      end: clonePoint(segment.end),
      visible: segment.visible !== false
    };
  }

  if (segment.kind === "quadratic") {
    return {
      kind: "quadratic",
      start: clonePoint(segment.start),
      control: clonePoint(segment.control),
      end: clonePoint(segment.end),
      visible: segment.visible !== false
    };
  }

  if (segment.kind === "arc") {
    return {
      kind: "arc",
      center: clonePoint(segment.center),
      radii: clonePoint(segment.radii),
      startAngle: segment.startAngle,
      endAngle: segment.endAngle,
      rotation: segment.rotation || 0,
      visible: segment.visible !== false
    };
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function tokenizePrimitive(input, startIndex) {
  const match = input.slice(startIndex).match(/^([TSCR])(\d+)?(?:r(-?\d+(?:\.\d+)?))?/);
  if (!match) {
    return null;
  }

  return {
    token: match[0],
    nextIndex: startIndex + match[0].length
  };
}

function parseModifierArgs(rawArgs, name) {
  if (!rawArgs.trim()) {
    if (name === "b") {
      return [];
    }
    throw new Error(`Modifier ${name} requires at least one argument`);
  }

  return rawArgs.split(",").map((part) => {
    const value = Number.parseFloat(part.trim());
    if (Number.isNaN(value)) {
      throw new Error(`Invalid number "${part}" in modifier ${name}`);
    }
    return value;
  });
}

export function tokenizeGlyphDefinition(input) {
  const tokens = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if ("*|[]-".includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    if ("tschb".includes(char) && input[index + 1] === "(") {
      let end = index + 2;
      while (end < input.length && input[end] !== ")") {
        end += 1;
      }

      if (end >= input.length) {
        throw new Error(`Unclosed modifier starting at index ${index}`);
      }

      const name = char;
      const args = parseModifierArgs(input.slice(index + 2, end), name);
      tokens.push({
        type: "modifier",
        name,
        args
      });
      index = end + 1;
      continue;
    }

    const primitive = tokenizePrimitive(input, index);
    if (primitive) {
      tokens.push({ type: "primitive", value: primitive.token });
      index = primitive.nextIndex;
      continue;
    }

    throw new Error(`Unexpected token "${char}" at index ${index}`);
  }

  return tokens;
}

function isPrimaryStart(token) {
  return token && (token.type === "primitive" || token.type === "[");
}

function normalizeScaleArgs(args) {
  if (args.length === 1) {
    return [args[0], args[0]];
  }

  if (args.length === 2) {
    return args;
  }

  throw new Error("s(...) accepts one or two arguments");
}

function normalizeTranslateArgs(args) {
  if (args.length !== 2) {
    throw new Error("t(...) requires exactly two arguments");
  }

  return args;
}

function normalizeCurveArgs(args) {
  if (args.length !== 1) {
    throw new Error("c(...) requires exactly one argument");
  }

  return args;
}

function normalizeHeartArgs(args) {
  if (args.length === 1) {
    return [args[0], args[0]];
  }

  if (args.length === 2) {
    return args;
  }

  throw new Error("h(...) accepts one or two arguments");
}

function normalizeBoundsArgs(args) {
  if (args.length !== 0) {
    throw new Error("b() does not take any arguments");
  }

  return args;
}

function parsePrimitiveToken(token) {
  const match = token.match(/^([TSCR])(\d+)?(?:r(-?\d+(?:\.\d+)?))?$/);
  if (!match) {
    throw new Error(`Invalid primitive token: ${token}`);
  }

  const symbol = match[1];
  const bits = match[2] ? Number.parseInt(match[2], 10) : null;
  const legacyRotate = match[3] ? Number.parseFloat(match[3]) : null;
  const hiddenEdges = bits !== null ? bitmaskToHiddenEdges(bits, {
    T: 3,
    S: 8,
    C: 4,
    R: 4
  }[symbol]) : [];

  const baseSpec = {
    T: {
      primitive: "triangle",
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE
    },
    S: {
      primitive: "starburst",
      points: 8,
      radius: HALF_DEFAULT_SIZE,
      mode: "radius"
    },
    C: {
      primitive: "arcCircle",
      radius: HALF_DEFAULT_SIZE
    },
    R: {
      primitive: "square",
      width: DEFAULT_SIZE,
      height: DEFAULT_SIZE
    }
  }[symbol];

  const modifiers = [];
  if (legacyRotate !== null) {
    modifiers.push({
      type: "rotate",
      args: [legacyRotate]
    });
  }

  return {
    type: "primitive",
    primitive: baseSpec.primitive,
    spec: {
      ...baseSpec,
      hiddenEdges
    },
    modifiers
  };
}

function cloneNode(node) {
  if (node.type === "primitive") {
    return {
      type: "primitive",
      primitive: node.primitive,
      spec: structuredClone(node.spec),
      modifiers: node.modifiers.map((modifier) => ({
        type: modifier.type,
        args: [...modifier.args]
      }))
    };
  }

  if (node.type === "composite") {
    return {
      type: "composite",
      layout: node.layout,
      rows: node.rows.map((row) => row.map(cloneNode)),
      modifiers: node.modifiers.map((modifier) => ({
        type: modifier.type,
        args: [...modifier.args]
      }))
    };
  }

  throw new Error(`Unknown node type: ${node.type}`);
}

export function parseGlyphDefinition(input) {
  const tokens = tokenizeGlyphDefinition(input);
  let index = 0;

  function currentToken() {
    return tokens[index];
  }

  function consume(expectedType) {
    const token = currentToken();
    if (!token || token.type !== expectedType) {
      throw new Error(`Expected ${expectedType} but found ${token ? token.type : "end of input"}`);
    }
    index += 1;
    return token;
  }

  function parseModifierToken() {
    const token = consume("modifier");

    if (token.name === "t") {
      return {
        type: "translate",
        args: normalizeTranslateArgs(token.args)
      };
    }

    if (token.name === "s") {
      return {
        type: "scale",
        args: normalizeScaleArgs(token.args)
      };
    }

    if (token.name === "c") {
      return {
        type: "curve",
        args: normalizeCurveArgs(token.args)
      };
    }

    if (token.name === "h") {
      return {
        type: "heart",
        args: normalizeHeartArgs(token.args)
      };
    }

    if (token.name === "b") {
      return {
        type: "bounds",
        args: normalizeBoundsArgs(token.args)
      };
    }

    throw new Error(`Unknown modifier ${token.name}`);
  }

  function parseSuffixed() {
    let node = parsePrimary();

    while (currentToken() && currentToken().type === "modifier") {
      const modifier = parseModifierToken();
      node = cloneNode(node);
      node.modifiers.push(modifier);
    }

    return node;
  }

  function parseOverlayTerm() {
    const children = [parseSuffixed()];

    while (currentToken() && currentToken().type === "*") {
      consume("*");
      children.push(parseSuffixed());
    }

    if (children.length === 1) {
      return children[0];
    }

    return {
      type: "composite",
      layout: "overlay",
      rows: [children],
      modifiers: []
    };
  }

  function parseRow() {
    const items = [];

    while (isPrimaryStart(currentToken())) {
      items.push(parseOverlayTerm());

      while (currentToken() && currentToken().type === "-") {
        consume("-");
      }
    }

    return items;
  }

  function parseExpression() {
    const rows = [];
    rows.push(parseRow());

    while (currentToken() && currentToken().type === "|") {
      consume("|");
      rows.push(parseRow());
    }

    return {
      type: "composite",
      layout: "grid",
      rows,
      modifiers: []
    };
  }

  function parsePrimary() {
    const token = currentToken();
    if (!token) {
      throw new Error("Unexpected end of input");
    }

    if (token.type === "primitive") {
      consume("primitive");
      return parsePrimitiveToken(token.value);
    }

    if (token.type === "[") {
      consume("[");
      const expression = parseExpression();
      consume("]");
      return expression;
    }

    throw new Error(`Unexpected token ${token.type}`);
  }

  const ast = parseExpression();

  if (index !== tokens.length) {
    throw new Error(`Unexpected trailing token ${currentToken().type}`);
  }

  return ast;
}

export function createPrimitiveNodeFromSpec(spec, modifiers = []) {
  return {
    type: "primitive",
    primitive: spec.primitive,
    spec: structuredClone(spec),
    modifiers: modifiers.map((modifier) => ({
      type: modifier.type,
      args: [...modifier.args]
    }))
  };
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

function edgeVisibility(edgeCount, hiddenEdges = []) {
  const hidden = new Set(hiddenEdges);
  return Array.from({ length: edgeCount }, (_, index) => !hidden.has(index));
}

function createPolygonSegments(points, hiddenEdges = []) {
  const visibleEdges = edgeVisibility(points.length, hiddenEdges);

  return points.map((point, index) => ({
    kind: "line",
    start: clonePoint(point),
    end: clonePoint(points[(index + 1) % points.length]),
    visible: visibleEdges[index]
  }));
}

function createArcSegments(radius, hiddenEdges = []) {
  const visibleEdges = edgeVisibility(4, hiddenEdges);

  return [
    { startAngle: -Math.PI / 2, endAngle: 0 },
    { startAngle: 0, endAngle: Math.PI / 2 },
    { startAngle: Math.PI / 2, endAngle: Math.PI },
    { startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 }
  ].map((arc, index) => ({
    kind: "arc",
    center: [0, 0],
    radii: [radius, radius],
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
    rotation: 0,
    visible: visibleEdges[index]
  }));
}

function rectangleRayIntersection(direction, halfWidth, halfHeight) {
  const [dx, dy] = direction;
  const tx = approxZero(dx) ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const ty = approxZero(dy) ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(tx, ty);
  return [dx * scale, dy * scale];
}

function createStarburstSegments(spec) {
  const count = spec.points || 4;
  const visibleEdges = edgeVisibility(count, spec.hiddenEdges);
  const angleOffset = -Math.PI / 2;
  const halfWidth = (spec.width || DEFAULT_SIZE) / 2;
  const halfHeight = (spec.height || DEFAULT_SIZE) / 2;
  const radius = spec.radius || HALF_DEFAULT_SIZE;

  return Array.from({ length: count }, (_, index) => {
    const angle = (index * 2 * Math.PI) / count + angleOffset;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const end = spec.mode === "bounds"
      ? rectangleRayIntersection(direction, halfWidth, halfHeight)
      : [direction[0] * radius, direction[1] * radius];

    return {
      kind: "line",
      start: [0, 0],
      end,
      visible: visibleEdges[index]
    };
  });
}

function createPrimitiveSegments(node) {
  const { spec } = node;

  if (node.primitive === "square") {
    const halfWidth = spec.width / 2;
    const halfHeight = spec.height / 2;
    return createPolygonSegments([
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight]
    ], spec.hiddenEdges);
  }

  if (node.primitive === "triangle") {
    const halfWidth = spec.width / 2;
    const halfHeight = spec.height / 2;
    return createPolygonSegments([
      [0, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight]
    ], spec.hiddenEdges);
  }

  if (node.primitive === "arcCircle") {
    return createArcSegments(spec.radius || HALF_DEFAULT_SIZE, spec.hiddenEdges);
  }

  if (node.primitive === "starburst") {
    return createStarburstSegments(spec);
  }

  throw new Error(`Unknown primitive ${node.primitive}`);
}

function createPrimitiveLayoutSegments(node) {
  return createPrimitiveSegments({
    ...node,
    spec: {
      ...node.spec,
      hiddenEdges: []
    }
  });
}

function applyPrimitiveSpecModifiers(node) {
  const spec = structuredClone(node.spec);
  const remainingModifiers = [];

  node.modifiers.forEach((modifier) => {
    if (modifier.type === "bounds") {
      if (node.primitive !== "starburst") {
        throw new Error("b() is only supported on starburst primitives");
      }
      spec.mode = "bounds";
      return;
    }

    remainingModifiers.push(modifier);
  });

  return {
    ...node,
    spec,
    modifiers: remainingModifiers
  };
}

function rotatePoint([x, y], degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return [
    x * cos - y * sin,
    x * sin + y * cos
  ];
}

function scalePoint([x, y], sx, sy) {
  return [x * sx, y * sy];
}

function translatePoint([x, y], dx, dy) {
  return [x + dx, y + dy];
}

function sampleArcPoint(segment, angle) {
  const [rx, ry] = segment.radii;
  const localPoint = [Math.cos(angle) * rx, Math.sin(angle) * ry];
  const rotated = rotatePoint(localPoint, segment.rotation || 0);
  return translatePoint(rotated, segment.center[0], segment.center[1]);
}

function midpointForArc(segment) {
  const angle = segment.startAngle + ((segment.endAngle - segment.startAngle) / 2);
  return sampleArcPoint(segment, angle);
}

function sampleSegmentPoints(segment, steps = SAMPLE_STEPS) {
  if (segment.kind === "line") {
    return [segment.start, segment.end];
  }

  if (segment.kind === "quadratic") {
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const mt = 1 - t;
      points.push([
        (mt * mt * segment.start[0]) + (2 * mt * t * segment.control[0]) + (t * t * segment.end[0]),
        (mt * mt * segment.start[1]) + (2 * mt * t * segment.control[1]) + (t * t * segment.end[1])
      ]);
    }
    return points;
  }

  if (segment.kind === "arc") {
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = segment.startAngle + ((segment.endAngle - segment.startAngle) * t);
      points.push(sampleArcPoint(segment, angle));
    }
    return points;
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function lineFromPoints(points, visible = true) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({
      kind: "line",
      start: clonePoint(points[index]),
      end: clonePoint(points[index + 1]),
      visible
    });
  }
  return segments;
}

function mapSegmentPoints(segment, mapper) {
  if (segment.kind === "line") {
    return [{
      kind: "line",
      start: mapper(segment.start),
      end: mapper(segment.end),
      visible: segment.visible !== false
    }];
  }

  if (segment.kind === "quadratic") {
    return [{
      kind: "quadratic",
      start: mapper(segment.start),
      control: mapper(segment.control),
      end: mapper(segment.end),
      visible: segment.visible !== false
    }];
  }

  if (segment.kind === "arc") {
    return lineFromPoints(sampleSegmentPoints(segment).map(mapper), segment.visible !== false);
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function applyModifierToSegments(segments, modifier) {
  if (modifier.type === "translate") {
    const [dx, dy] = modifier.args;
    return segments.map((segment) => {
      if (segment.kind === "arc") {
        return {
          ...cloneSegment(segment),
          center: translatePoint(segment.center, dx, dy)
        };
      }

      return mapSegmentPoints(segment, (point) => translatePoint(point, dx, dy))[0];
    });
  }

  if (modifier.type === "scale") {
    const [sx, sy] = modifier.args;
    const canScaleArcExactly = (segment) => (
      segment.kind === "arc"
      && sx >= 0
      && sy >= 0
      && (approxEqual(sx, sy) || approxZero(segment.rotation || 0))
    );

    return segments.flatMap((segment) => {
      if (segment.kind === "arc" && canScaleArcExactly(segment)) {
        return [{
          ...cloneSegment(segment),
          center: scalePoint(segment.center, sx, sy),
          radii: [
            segment.radii[0] * sx,
            segment.radii[1] * sy
          ]
        }];
      }

      return mapSegmentPoints(segment, (point) => scalePoint(point, sx, sy));
    });
  }

  if (modifier.type === "rotate") {
    const [degrees] = modifier.args;

    return segments.flatMap((segment) => {
      if (segment.kind === "arc") {
        return [{
          ...cloneSegment(segment),
          center: rotatePoint(segment.center, degrees),
          rotation: (segment.rotation || 0) + degrees
        }];
      }

      return mapSegmentPoints(segment, (point) => rotatePoint(point, degrees));
    });
  }

  if (modifier.type === "curve") {
    const [amount] = modifier.args;

    if (approxZero(amount)) {
      return segments.map(cloneSegment);
    }

    return segments.map((segment) => {
      if (segment.kind !== "line") {
        return cloneSegment(segment);
      }

      const dx = segment.end[0] - segment.start[0];
      const dy = segment.end[1] - segment.start[1];
      const length = Math.hypot(dx, dy);

      if (approxZero(length)) {
        return cloneSegment(segment);
      }

      const midpoint = [
        (segment.start[0] + segment.end[0]) / 2,
        (segment.start[1] + segment.end[1]) / 2
      ];
      const normal = [-dy / length, dx / length];
      const offset = amount * length * 0.5;

      return {
        kind: "quadratic",
        start: clonePoint(segment.start),
        control: [
          midpoint[0] + normal[0] * offset,
          midpoint[1] + normal[1] * offset
        ],
        end: clonePoint(segment.end),
        visible: segment.visible !== false
      };
    });
  }

  if (modifier.type === "heart") {
    const [lobeAmount, taperAmount] = modifier.args;

    if (approxZero(lobeAmount) && approxZero(taperAmount)) {
      return segments.map(cloneSegment);
    }

    return segments.map((segment) => {
      if (segment.kind !== "arc") {
        return cloneSegment(segment);
      }

      const start = sampleArcPoint(segment, segment.startAngle);
      const end = sampleArcPoint(segment, segment.endAngle);
      const midpoint = midpointForArc(segment);
      const horizontalSign = Math.sign(midpoint[0] - segment.center[0]);
      const verticalSign = Math.sign(midpoint[1] - segment.center[1]);

      if (approxZero(horizontalSign) || approxZero(verticalSign)) {
        return cloneSegment(segment);
      }

      const amount = verticalSign < 0 ? lobeAmount : taperAmount;
      const controlLocal = [
        horizontalSign * segment.radii[0] * (1 + amount),
        verticalSign * segment.radii[1] * (1 + amount)
      ];
      const rotatedControl = rotatePoint(controlLocal, segment.rotation || 0);

      return {
        kind: "quadratic",
        start,
        control: translatePoint(rotatedControl, segment.center[0], segment.center[1]),
        end,
        visible: segment.visible !== false
      };
    });
  }

  throw new Error(`Unknown modifier type: ${modifier.type}`);
}

function applyModifiers(segments, modifiers) {
  return modifiers.reduce((current, modifier) => applyModifierToSegments(current, modifier), segments);
}

function partitionModifiers(modifiers) {
  const layoutModifiers = [];
  const postLayoutModifiers = [];

  modifiers.forEach((modifier) => {
    if (modifier.type === "translate") {
      postLayoutModifiers.push(modifier);
      return;
    }

    layoutModifiers.push(modifier);
  });

  return {
    layoutModifiers,
    postLayoutModifiers
  };
}

export function measureSegments(segments) {
  const visiblePoints = [];

  segments.forEach((segment) => {
    if (segment.visible === false) {
      return;
    }
    visiblePoints.push(...sampleSegmentPoints(segment));
  });

  if (visiblePoints.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 0,
      height: 0,
      cx: 0,
      cy: 0
    };
  }

  const xs = visiblePoints.map(([x]) => x);
  const ys = visiblePoints.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  };
}

function translateSegments(segments, dx, dy) {
  return applyModifierToSegments(segments, {
    type: "translate",
    args: [dx, dy]
  });
}

function compileGridComposite(node) {
  const compiledRows = node.rows.map((row) => row.map((child) => compileGlyphNode(child)));
  const rowHeights = compiledRows.map((row) => Math.max(0, ...row.map((entry) => entry.layoutBBox.height)));
  const columnCount = Math.max(0, ...compiledRows.map((row) => row.length));
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => (
    Math.max(0, ...compiledRows.map((row) => (row[columnIndex] ? row[columnIndex].layoutBBox.width : 0)))
  ));

  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  let cursorY = -totalHeight / 2;
  const positioned = [];

  compiledRows.forEach((row, rowIndex) => {
    let cursorX = -totalWidth / 2;
    const rowHeight = rowHeights[rowIndex];

    row.forEach((entry, columnIndex) => {
      const columnWidth = columnWidths[columnIndex];
      const dx = cursorX + (columnWidth / 2) - entry.layoutBBox.cx;
      const dy = cursorY + (rowHeight / 2) - entry.layoutBBox.cy;
      positioned.push(...translateSegments(entry.segments, dx, dy));
      cursorX += columnWidth;
    });

    cursorY += rowHeight;
  });

  return positioned;
}

function compileOverlayComposite(node) {
  return node.rows.flat().flatMap((child) => compileGlyphNode(child).segments);
}

export function compileGlyphNode(node) {
  if (node.type === "primitive") {
    const modifiedNode = applyPrimitiveSpecModifiers(node);
    const { layoutModifiers, postLayoutModifiers } = partitionModifiers(modifiedNode.modifiers);
    const layoutSegments = applyModifiers(createPrimitiveLayoutSegments(modifiedNode), layoutModifiers);
    const visibleSegments = applyModifiers(createPrimitiveSegments(modifiedNode), layoutModifiers);
    const segments = applyModifiers(visibleSegments, postLayoutModifiers);
    return {
      layoutSegments,
      layoutBBox: measureSegments(layoutSegments),
      segments,
      bbox: measureSegments(segments)
    };
  }

  if (node.type === "composite") {
    const { layoutModifiers, postLayoutModifiers } = partitionModifiers(node.modifiers);
    const baseSegments = node.layout === "overlay"
      ? compileOverlayComposite(node)
      : compileGridComposite(node);
    const layoutSegments = applyModifiers(baseSegments, layoutModifiers);
    const segments = applyModifiers(layoutSegments, postLayoutModifiers);
    return {
      layoutSegments,
      layoutBBox: measureSegments(layoutSegments),
      segments,
      bbox: measureSegments(segments)
    };
  }

  throw new Error(`Unknown node type: ${node.type}`);
}

export function compileGlyphDefinition(definition) {
  return compileGlyphNode(parseGlyphDefinition(definition));
}

export function fitSegmentsToTarget(segments, targetWidth = DEFAULT_SIZE, targetHeight = DEFAULT_SIZE) {
  const bbox = measureSegments(segments);

  if (bbox.width === 0 && bbox.height === 0) {
    return segments.map(cloneSegment);
  }

  const scaleCandidates = [];
  if (bbox.width > 0) {
    scaleCandidates.push(targetWidth / bbox.width);
  }
  if (bbox.height > 0) {
    scaleCandidates.push(targetHeight / bbox.height);
  }
  const scale = scaleCandidates.length > 0 ? Math.min(...scaleCandidates) : 1;

  return applyModifiers(segments, [
    {
      type: "translate",
      args: [-bbox.cx, -bbox.cy]
    },
    {
      type: "scale",
      args: [scale, scale]
    }
  ]);
}

export function summarizeCompiledNode(node) {
  const compiled = compileGlyphNode(node);
  const visibleSegments = compiled.segments.filter((segment) => segment.visible !== false);
  const counts = visibleSegments.reduce((summary, segment) => {
    summary[segment.kind] = (summary[segment.kind] || 0) + 1;
    return summary;
  }, {});

  return {
    counts,
    bbox: compiled.bbox
  };
}
