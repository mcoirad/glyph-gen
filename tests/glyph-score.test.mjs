import test from "node:test";
import assert from "node:assert/strict";

import { compileGlyphDefinition } from "../glyph-core.mjs";
import {
  DEFAULT_SCORE_WEIGHTS,
  extractGlyphFeatures,
  extractSegmentFeatures,
  scoreGlyph,
  scoreSegments
} from "../glyph-score.mjs";

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("extractGlyphFeatures returns documented score and metric fields", () => {
  const result = extractGlyphFeatures("R");

  assert.deepEqual(Object.keys(result).sort(), ["metrics", "scores"]);
  assert.equal(typeof result.scores.verticalSymmetry, "number");
  assert.equal(typeof result.scores.horizontalSymmetry, "number");
  assert.equal(typeof result.scores.connectivity, "number");
  assert.equal(typeof result.scores.density, "number");
  assert.equal(typeof result.scores.balance, "number");
  assert.equal(typeof result.scores.complexity, "number");
  assert.equal("novelty" in result.scores, false);
  assert.equal(result.metrics.segmentCount, 4);
  assert.equal(result.metrics.componentCount, 1);
  assert.equal(result.metrics.danglingEndpointCount, 0);
  assert.equal(result.metrics.nearMissCount, 0);
  assert.equal(typeof result.metrics.occupiedCellRatio, "number");
  assert.equal(typeof result.metrics.bbox.width, "number");
  assert.equal(typeof result.metrics.centroidOffset.distance, "number");
});

test("extractSegmentFeatures and scoreSegments work on compiled segments", () => {
  const compiled = compileGlyphDefinition("R");
  const features = extractSegmentFeatures(compiled.segments);
  const scored = scoreSegments(compiled.segments);

  assert.equal(features.metrics.segmentCount, 4);
  assert.equal(scored.metrics.segmentCount, 4);
  assert.equal(typeof scored.overall, "number");
  assert.deepEqual(Object.keys(scored.weightsUsed).sort(), Object.keys(DEFAULT_SCORE_WEIGHTS).filter((key) => (
    DEFAULT_SCORE_WEIGHTS[key] > 0
  )).sort());
});

test("overall respects custom weights and ignores zero-weight features", () => {
  const result = scoreGlyph("T3r270|R2", {
    weights: {
      verticalSymmetry: 1,
      horizontalSymmetry: 0,
      connectivity: 0,
      density: 0,
      balance: 0,
      complexity: 0,
      novelty: 0
    }
  });

  approxEqual(result.overall, result.scores.verticalSymmetry);
  assert.deepEqual(result.weightsUsed, {
    verticalSymmetry: 1
  });
});

test("symmetry scores differentiate strong and weak candidates by axis", () => {
  const symmetric = scoreGlyph("R");
  const verticalAsymmetric = scoreGlyph("T3r270|R2");
  const horizontalAsymmetric = scoreGlyph("T5r180 T5r180");

  assert(symmetric.scores.verticalSymmetry > verticalAsymmetric.scores.verticalSymmetry);
  assert(symmetric.scores.horizontalSymmetry > horizontalAsymmetric.scores.horizontalSymmetry);
});

test("A T and Y-like Roman glyphs score as highly vertically symmetric", () => {
  const aLike = scoreGlyph("T|R10");
  const tLike = scoreGlyph("S68 b() | S17");
  const yLike = scoreGlyph("T5 | S17");
  const asymmetric = scoreGlyph("T3r270|R2");

  assert(aLike.scores.verticalSymmetry > 0.95);
  assert(tLike.scores.verticalSymmetry > 0.95);
  assert(yLike.scores.verticalSymmetry > 0.95);
  assert(asymmetric.scores.verticalSymmetry < 0.5);
});

test("connectivity scores penalize disconnected multi-part glyphs", () => {
  const connected = scoreGlyph("R");
  const disconnected = scoreGlyph("S17 * R5");

  assert(connected.scores.connectivity > disconnected.scores.connectivity);
  assert(connected.metrics.componentCount < disconnected.metrics.componentCount);
});

test("density scores favor moderate occupancy over sparse or dense glyphs", () => {
  const sparse = scoreGlyph("S17");
  const moderate = scoreGlyph("R");
  const dense = scoreGlyph("R R|R R");

  assert(moderate.scores.density > sparse.scores.density);
  assert(moderate.scores.density > dense.scores.density);
});

test("balance scores drop for off-center glyphs when normalization is disabled", () => {
  const centered = scoreGlyph("R", {
    normalize: false
  });
  const offset = scoreGlyph("S17 t(12,0)", {
    normalize: false
  });

  assert(centered.scores.balance > offset.scores.balance);
  assert(centered.metrics.centroidOffset.distance < offset.metrics.centroidOffset.distance);
});

test("complexity scores prefer mid-complexity glyphs over very simple or very busy ones", () => {
  const simple = scoreGlyph("S17");
  const medium = scoreGlyph("R10 * T4r270 | R10 | R10");
  const busy = scoreGlyph("R R R|R R R|R R R");

  assert(medium.scores.complexity > simple.scores.complexity);
  assert(medium.scores.complexity > busy.scores.complexity);
});

test("novelty uses reference glyphs and treats identical references as non-novel", () => {
  const identical = scoreGlyph("R", {
    references: ["R"]
  });
  const dissimilar = scoreGlyph("R", {
    references: ["S17"]
  });

  approxEqual(identical.scores.novelty, 0);
  assert(dissimilar.scores.novelty > identical.scores.novelty);
});
