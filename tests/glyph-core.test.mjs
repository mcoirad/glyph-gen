import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBrushSegmentShape,
  compileGlyphDefinition,
  compileGlyphNode,
  DEFAULT_SIZE,
  createPrimitiveNodeFromSpec,
  fitSegmentsToTarget,
  measureSegments,
  parseGlyphDefinition,
  phoenicianGlyphs,
  renderGlyphNode,
  summarizeCompiledNode
} from "../glyph-core.mjs";

function roundBBox(bbox) {
  const clean = (value) => {
    const rounded = Number(value.toFixed(4));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return {
    width: clean(bbox.width),
    height: clean(bbox.height),
    cx: clean(bbox.cx),
    cy: clean(bbox.cy)
  };
}

function visibleSegments(segments) {
  return segments.filter((segment) => segment.visible !== false);
}

function roundPoint([x, y]) {
  const clean = (value) => {
    const rounded = Number(value.toFixed(4));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return [
    clean(x),
    clean(y)
  ];
}

function createFakeGroup() {
  const makeShape = () => ({
    fill() {
      return this;
    },
    stroke() {
      return this;
    },
    attr() {
      return this;
    }
  });

  return {
    line() {
      return makeShape();
    },
    path() {
      return makeShape();
    },
    polygon() {
      return makeShape();
    }
  };
}

test("existing Phoenician glyph definitions still parse", () => {
  for (const definition of Object.values(phoenicianGlyphs)) {
    assert.doesNotThrow(() => parseGlyphDefinition(definition));
  }
});

test("suffix modifiers attach to primitives and grouped expressions", () => {
  const primitiveAst = parseGlyphDefinition("S17 t(4,-2) s(1.2,0.9)");
  const primitiveNode = primitiveAst.rows[0][0];
  assert.deepEqual(
    primitiveNode.modifiers.map((modifier) => [modifier.type, modifier.args]),
    [
      ["translate", [4, -2]],
      ["scale", [1.2, 0.9]]
    ]
  );

  const groupedAst = parseGlyphDefinition("[C*S17] t(2,0)");
  const groupedNode = groupedAst.rows[0][0];
  assert.equal(groupedNode.type, "composite");
  assert.equal(groupedNode.layout, "grid");
  assert.deepEqual(groupedNode.modifiers, [
    {
      type: "translate",
      args: [2, 0]
    }
  ]);

  const boundedStarburstAst = parseGlyphDefinition("S17 b()");
  const boundedStarburstNode = boundedStarburstAst.rows[0][0];
  assert.deepEqual(
    boundedStarburstNode.modifiers.map((modifier) => [modifier.type, modifier.args]),
    [["bounds", []]]
  );

  const heartArcAst = parseGlyphDefinition("C3 h(0.35,0.65)");
  const heartArcNode = heartArcAst.rows[0][0];
  assert.deepEqual(
    heartArcNode.modifiers.map((modifier) => [modifier.type, modifier.args]),
    [["heart", [0.35, 0.65]]]
  );
});

test("modifier order is preserved left to right", () => {
  const ast = parseGlyphDefinition("R t(3,-2) s(2,0.5) c(0.25)");
  const node = ast.rows[0][0];
  assert.deepEqual(
    node.modifiers.map((modifier) => modifier.type),
    ["translate", "scale", "curve"]
  );
});

test("hidden edges are excluded consistently from compiled geometry measurement", () => {
  const compiled = compileGlyphDefinition("R1");
  const segments = visibleSegments(compiled.segments);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, "line");
  assert.deepEqual(roundBBox(compiled.bbox), {
    width: 60,
    height: 0,
    cx: 0,
    cy: -30
  });
});

test("translate and scale modifiers change the measured bbox", () => {
  const compiled = compileGlyphDefinition("R s(2,0.5) t(10,-5)");

  assert.deepEqual(roundBBox(compiled.bbox), {
    width: 120,
    height: 30,
    cx: 10,
    cy: -5
  });
});

test("c(0) preserves straight geometry and bbox", () => {
  const base = compileGlyphDefinition("R");
  const curved = compileGlyphDefinition("R c(0)");

  assert.deepEqual(
    visibleSegments(curved.segments).map((segment) => segment.kind),
    ["line", "line", "line", "line"]
  );
  assert.deepEqual(roundBBox(base.bbox), roundBBox(curved.bbox));
});

test("line brush outline uses translated corners", () => {
  const shape = buildBrushSegmentShape({
    kind: "line",
    start: [0, 0],
    end: [10, 0],
    visible: true
  }, {
    angle: 90,
    thickness: 4
  });

  assert.equal(shape.kind, "polygon");
  assert.deepEqual(shape.points.map(roundPoint), [
    [0, 2],
    [10, 2],
    [10, -2],
    [0, -2]
  ]);
});

test("quadratic brush outline closes on translated endpoints", () => {
  const shape = buildBrushSegmentShape({
    kind: "quadratic",
    start: [0, 0],
    control: [5, 10],
    end: [10, 0],
    visible: true
  }, {
    angle: 90,
    thickness: 4
  });

  assert.equal(shape.kind, "path");
  assert.deepEqual(shape.commands.map((command) => command.type), ["M", "Q", "L", "Q", "Z"]);
  assert.deepEqual(roundPoint(shape.commands[0].point), [0, 2]);
  assert.deepEqual(roundPoint(shape.commands[1].control), [5, 12]);
  assert.deepEqual(roundPoint(shape.commands[1].point), [10, 2]);
  assert.deepEqual(roundPoint(shape.commands[2].point), [10, -2]);
  assert.deepEqual(roundPoint(shape.commands[3].control), [5, 8]);
  assert.deepEqual(roundPoint(shape.commands[3].point), [0, -2]);
});

test("arc brush outline preserves top arc flags and reverses lower sweep", () => {
  const shape = buildBrushSegmentShape({
    kind: "arc",
    center: [0, 0],
    radii: [30, 30],
    startAngle: 0,
    endAngle: Math.PI / 2,
    rotation: 0,
    visible: true
  }, {
    angle: 0,
    thickness: 10
  });

  assert.equal(shape.kind, "path");
  assert.deepEqual(shape.commands.map((command) => command.type), ["M", "A", "L", "A", "Z"]);
  assert.deepEqual(roundPoint(shape.commands[0].point), [35, 0]);
  assert.equal(shape.commands[1].largeArcFlag, 0);
  assert.equal(shape.commands[1].sweepFlag, 1);
  assert.deepEqual(roundPoint(shape.commands[1].point), [5, 30]);
  assert.deepEqual(roundPoint(shape.commands[2].point), [-5, 30]);
  assert.equal(shape.commands[3].largeArcFlag, 0);
  assert.equal(shape.commands[3].sweepFlag, 0);
  assert.deepEqual(roundPoint(shape.commands[3].point), [25, 0]);
});

test("bounded starburst reaches the rectangular bounds", () => {
  const node = createPrimitiveNodeFromSpec({
    primitive: "starburst",
    points: 8,
    mode: "bounds",
    width: 60,
    height: 60,
    hiddenEdges: []
  });
  const compiled = compileGlyphNode(node);
  const endpoints = visibleSegments(compiled.segments).map((segment) => (
    segment.end.map((value) => Number(value.toFixed(4)))
  ));

  assert.deepEqual(roundBBox(compiled.bbox), {
    width: 60,
    height: 60,
    cx: 0,
    cy: 0
  });
  assert(endpoints.some(([x, y]) => x === 0 && y === -30));
  assert(endpoints.some(([x, y]) => x === 30 && y === 0));
  assert(endpoints.some(([x, y]) => x === 30 && y === 30));
});

test("b() switches starbursts to cell bounds mode", () => {
  const circular = compileGlyphDefinition("S19");
  const bounded = compileGlyphDefinition("S19 b()");
  const circularEndpoints = visibleSegments(circular.segments).map((segment) => (
    segment.end.map((value) => Number(value.toFixed(4)))
  ));
  const boundedEndpoints = visibleSegments(bounded.segments).map((segment) => (
    segment.end.map((value) => Number(value.toFixed(4)))
  ));

  assert.deepEqual(circularEndpoints, [
    [0, -30],
    [21.2132, -21.2132],
    [0, 30]
  ]);
  assert.deepEqual(boundedEndpoints, [
    [0, -30],
    [30, -30],
    [0, 30]
  ]);
});

test("h() warps visible arc segments into a half-heart profile", () => {
  const compiled = compileGlyphDefinition("C3 h(0.35,0.65)");
  const segments = visibleSegments(compiled.segments);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["quadratic", "quadratic"]
  );
  assert(segments[0].control[0] < segments[1].control[0]);
  assert(segments[0].control[1] < segments[0].start[1]);
  assert(segments[1].control[1] > segments[1].end[1]);
  assert(compiled.bbox.width > 30);
  assert(compiled.bbox.height > 60);
});

test("grid keeps full cell anchors for edge-only cells", () => {
  const compiled = compileGlyphDefinition("T3r270|R2");
  const verticals = visibleSegments(compiled.segments).filter((segment) => (
    segment.kind === "line"
    && Math.abs(segment.start[0] - segment.end[0]) <= 0.0001
    && Math.abs(segment.start[1] - segment.end[1]) >= 59.9999
  ));

  assert.deepEqual(roundBBox(compiled.bbox), {
    width: 60,
    height: 120,
    cx: 0,
    cy: 0
  });
  assert.equal(verticals.length, 2);
  assert(verticals.every((segment) => roundBBox({
    width: 0,
    height: 0,
    cx: segment.start[0],
    cy: 0
  }).cx === 30));
});

test("translate modifiers survive grid placement for edge-only cells", () => {
  const compiled = compileGlyphDefinition("T3r270|R2 t(10,0)");
  const verticals = visibleSegments(compiled.segments).filter((segment) => (
    segment.kind === "line"
    && Math.abs(segment.start[0] - segment.end[0]) <= 0.0001
    && Math.abs(segment.start[1] - segment.end[1]) >= 59.9999
  ));

  assert.deepEqual(roundBBox(compiled.bbox), {
    width: 70,
    height: 120,
    cx: 5,
    cy: 0
  });
  assert.deepEqual(
    verticals.map((segment) => roundBBox({
      width: 0,
      height: 0,
      cx: segment.start[0],
      cy: 0
    }).cx),
    [30, 40]
  );
});

test("selected glyph fixtures preserve expected compiled geometry", () => {
  const fixtures = {
    aleph: {
      counts: { line: 4 },
      bbox: { width: 60, height: 60, cx: 0, cy: 0 }
    },
    tet: {
      counts: { arc: 4, line: 4 },
      bbox: { width: 60, height: 60, cx: 0, cy: 0 }
    },
    qop: {
      counts: { arc: 4, line: 3 },
      bbox: { width: 60, height: 90, cx: 0, cy: -15 }
    },
    pe: {
      counts: { quadratic: 2 },
      bbox: { width: 35.5052, height: 67.6667, cx: 17.7526, cy: 0 }
    },
    sade: {
      counts: { line: 5 },
      bbox: { width: 90, height: 60, cx: 15, cy: 0 }
    },
    shin: {
      counts: { line: 4 },
      bbox: { width: 120, height: 60, cx: 0, cy: 0 }
    }
  };

  for (const [name, expected] of Object.entries(fixtures)) {
    const summary = summarizeCompiledNode(parseGlyphDefinition(phoenicianGlyphs[name]));
    assert.deepEqual(summary.counts, expected.counts);
    assert.deepEqual(roundBBox(summary.bbox), expected.bbox);
  }
});

test("mem and nun keep their spine on the right side", () => {
  const findTallVerticalSegments = (definition) => {
    const compiled = compileGlyphDefinition(definition);
    const verticals = visibleSegments(compiled.segments).filter((segment) => (
      segment.kind === "line"
      && Math.abs(segment.start[0] - segment.end[0]) <= 0.0001
      && Math.abs(segment.start[1] - segment.end[1]) >= 59.9999
    ));

    return {
      bbox: compiled.bbox,
      verticals
    };
  };

  const mem = findTallVerticalSegments(phoenicianGlyphs.mem);
  const nun = findTallVerticalSegments(phoenicianGlyphs.nun);

  assert.equal(mem.verticals.length, 3);
  assert(mem.verticals.every((segment) => (
    Math.abs(segment.start[0] - mem.bbox.maxX) <= 0.0001
    && Math.abs(segment.end[0] - mem.bbox.maxX) <= 0.0001
  )));

  assert.equal(nun.verticals.length, 3);
  assert(nun.verticals.every((segment) => (
    Math.abs(segment.start[0] - nun.bbox.maxX) <= 0.0001
    && Math.abs(segment.end[0] - nun.bbox.maxX) <= 0.0001
  )));
});

test("compiled glyphs fit back into the default cell", () => {
  const compiled = compileGlyphDefinition(phoenicianGlyphs.qop);
  const fitted = fitSegmentsToTarget(compiled.segments);
  const bbox = measureSegments(fitted);

  assert(bbox.width <= 60.0001);
  assert(bbox.height <= 60.0001);
  assert(Math.abs(bbox.cx) <= 0.0001);
  assert(Math.abs(bbox.cy) <= 0.0001);
});

test("brush render mode does not change fitted geometry", () => {
  const node = parseGlyphDefinition(phoenicianGlyphs.pe);
  const strokeGroup = createFakeGroup();
  const brushGroup = createFakeGroup();
  const stroked = renderGlyphNode(node, strokeGroup, {
    targetWidth: DEFAULT_SIZE,
    targetHeight: DEFAULT_SIZE
  });
  const brushed = renderGlyphNode(node, brushGroup, {
    targetWidth: DEFAULT_SIZE,
    targetHeight: DEFAULT_SIZE,
    mode: "brush",
    brush: {
      angle: 30,
      thickness: 8
    }
  });

  assert.deepEqual(roundBBox(measureSegments(stroked)), roundBBox(measureSegments(brushed)));
});
