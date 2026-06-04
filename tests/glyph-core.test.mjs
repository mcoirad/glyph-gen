import test from "node:test";
import assert from "node:assert/strict";

import {
  compileGlyphDefinition,
  compileGlyphNode,
  createPrimitiveNodeFromSpec,
  fitSegmentsToTarget,
  measureSegments,
  parseGlyphDefinition,
  phoenicianGlyphs,
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
      bbox: { width: 60, height: 75, cx: 0, cy: -7.5 }
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

  assert.deepEqual(roundBBox(mem.bbox), {
    width: 120,
    height: 180,
    cx: 0,
    cy: 0
  });
  assert.equal(mem.verticals.length, 2);
  assert(mem.verticals.every((segment) => segment.start[0] > 0 && segment.end[0] > 0));

  assert.deepEqual(roundBBox(nun.bbox), {
    width: 90,
    height: 180,
    cx: 15,
    cy: 0
  });
  assert.equal(nun.verticals.length, 2);
  assert(nun.verticals.every((segment) => segment.start[0] > 0 && segment.end[0] > 0));
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
