import test from "node:test";
import assert from "node:assert/strict";

import { compileGlyphDefinition, parseGlyphDefinition } from "../glyph-core.mjs";
import {
  DEFAULT_SET_GRAMMAR_DEFAULTS,
  generateGlyphSet,
  induceSetGrammar,
  SET_GRAMMAR_VERSION,
  validateSetGrammar
} from "../glyph-generate.mjs";

const CUSTOM_SOURCE = {
  a: "T|R10",
  b: "Tr90|Tr90",
  c: "C12",
  d: "S17 * C3"
};

test("induceSetGrammar returns a serializable grammar with structure and slot priors", () => {
  const { grammar, diagnostics } = induceSetGrammar("phoenician");

  assert.equal(grammar.version, SET_GRAMMAR_VERSION);
  assert.equal(grammar.metadata.sourceLabel, "phoenician");
  assert(Array.isArray(grammar.setPriors.slotOrder));
  assert(grammar.setPriors.slotOrder.length > 0);
  assert.equal(typeof grammar.setPriors.slotProfiles.aleph, "object");
  assert.equal(typeof grammar.structureModel.nodeFamilies.root[0].probability, "number");
  assert.equal(typeof grammar.attributeModel.primitiveKinds.any[0].probability, "number");
  assert.equal(typeof grammar.defaults.backoffWeight, "number");
  assert.equal(typeof grammar.setPriors.acceptance.connectivityFloor, "number");
  assert.equal(typeof grammar.setPriors.acceptance.verticalSymmetryCoverageFloor, "number");
  assert.equal(typeof grammar.setPriors.acceptance.horizontalSymmetryCoverageFloor, "number");
  assert.equal(typeof grammar.setPriors.acceptance.complexityFloor, "number");
  assert.equal(typeof grammar.setPriors.acceptance.complexityCeiling, "number");
  assert.equal(typeof grammar.setPriors.diversity.minRepeatedGlyphCount, "number");
  assert.equal(typeof diagnostics.uniqueStructureCount, "number");

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(grammar)));
});

test("induced grammars carry the expected default global thresholds", () => {
  const { grammar } = induceSetGrammar("roman");

  assert.equal(grammar.setPriors.acceptance.connectivityFloor, DEFAULT_SET_GRAMMAR_DEFAULTS.connectivityFloor);
  assert.equal(grammar.setPriors.acceptance.complexityCeiling, DEFAULT_SET_GRAMMAR_DEFAULTS.complexityCeiling);
  assert.equal(grammar.setPriors.diversity.minRepeatedGlyphCount, DEFAULT_SET_GRAMMAR_DEFAULTS.minRepeatedGlyphCount);
  assert.equal(
    grammar.setPriors.diversity.maxRepeatedStructureCount,
    DEFAULT_SET_GRAMMAR_DEFAULTS.maxRepeatedStructureCount
  );
});

test("induceSetGrammar accepts a custom glyph map", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);

  assert.equal(grammar.metadata.sourceLabel, "custom");
  assert.deepEqual(grammar.setPriors.slotOrder, ["a", "b", "c", "d"]);
  assert.deepEqual(Object.keys(grammar.setPriors.slotProfiles), ["a", "b", "c", "d"]);
});

test("induced slot profiles expose the fields required by the bounds editor", () => {
  const { grammar } = induceSetGrammar("roman");
  const slotKey = grammar.setPriors.slotOrder[0];
  const profile = grammar.setPriors.slotProfiles[slotKey];

  assert.equal(typeof profile.sourceDefinition, "string");
  assert.equal(typeof profile.target.overall, "number");
  assert.equal(typeof profile.target.scores.density, "number");
  assert.equal(typeof profile.target.metrics.segmentCount, "number");
  assert.equal(typeof profile.ranges.overall.min, "number");
  assert.equal(typeof profile.ranges.overall.max, "number");
  assert.equal(typeof profile.ranges.scores.balance.min, "number");
  assert.equal(typeof profile.ranges.scores.balance.max, "number");
  assert.equal(typeof profile.ranges.metrics.primitiveCount.min, "number");
  assert.equal(typeof profile.ranges.metrics.primitiveCount.max, "number");
  assert(Array.isArray(profile.modifierTypes));
});

test("validateSetGrammar rejects missing required structure distributions", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const brokenGrammar = structuredClone(grammar);

  delete brokenGrammar.structureModel.nodeFamilies.root;

  assert.throws(() => validateSetGrammar(brokenGrammar), /nodeFamilies\.root is required/);
});

test("generateGlyphSet is deterministic for the same grammar and seed", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const first = generateGlyphSet({ grammar, seed: "deterministic" });
  const second = generateGlyphSet({ grammar, seed: "deterministic" });

  assert.deepEqual(first.definitions, second.definitions);
  assert.deepEqual(first.glyphs, second.glyphs);
});

test("generateGlyphSet returns a parseable full set keyed by slot order", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const result = generateGlyphSet({ grammar, seed: "custom-set" });
  const definitions = Object.values(result.definitions);

  assert.deepEqual(Object.keys(result.definitions), grammar.setPriors.slotOrder);
  assert.equal(definitions.length, grammar.setPriors.slotOrder.length);
  assert.equal(new Set(definitions).size, definitions.length);

  definitions.forEach((definition) => {
    assert.doesNotThrow(() => parseGlyphDefinition(definition));
    assert.doesNotThrow(() => compileGlyphDefinition(definition));
  });
});

test("generateGlyphSet fills optional priors from defaults when they are omitted", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const callerGrammar = structuredClone(grammar);

  delete callerGrammar.defaults;
  delete callerGrammar.setPriors.diversity;
  delete callerGrammar.setPriors.acceptance;

  const result = generateGlyphSet({ grammar: callerGrammar, seed: "defaults" });

  assert.equal(typeof result.setDiagnostics.overallAverage, "number");
  assert.equal(typeof result.setDiagnostics.repeatedGlyphCount, "number");
  assert.deepEqual(Object.keys(result.definitions), grammar.setPriors.slotOrder);
});

function bestEffortRejectionReasons(acceptance) {
  const { grammar } = induceSetGrammar({
    solo: "R"
  });

  grammar.setPriors.acceptance = {
    ...grammar.setPriors.acceptance,
    overallScoreFloor: 0,
    slotFitFloor: 0,
    noveltyFloor: 0,
    ...acceptance
  };

  const result = generateGlyphSet({
    grammar,
    seed: "forced-rejection",
    maxAttemptsPerGlyph: 1,
    maxSetAttempts: 1
  });

  return result.glyphs.solo.rejectionCounts;
}

test("generateGlyphSet normalizes new acceptance floors from defaults", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const callerGrammar = structuredClone(grammar);

  delete callerGrammar.defaults;
  delete callerGrammar.setPriors.acceptance;

  const result = generateGlyphSet({ grammar: callerGrammar, seed: "acceptance-defaults" });

  assert.equal(typeof result.setDiagnostics.slotFitAverage, "number");
  assert.deepEqual(Object.keys(result.definitions), grammar.setPriors.slotOrder);
});

test("generateGlyphSet normalizes minRepeatedGlyphCount from defaults", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);
  const callerGrammar = structuredClone(grammar);

  delete callerGrammar.defaults;
  delete callerGrammar.setPriors.diversity;

  const result = generateGlyphSet({ grammar: callerGrammar, seed: "diversity-defaults" });

  assert.equal(typeof result.setDiagnostics.repeatedGlyphCount, "number");
  assert.equal(typeof result.setDiagnostics.meetsMinRepeatedGlyphCount, "boolean");
});

test("generateGlyphSet rejects candidates below the connectivity floor", () => {
  const rejectionCounts = bestEffortRejectionReasons({
    connectivityFloor: 1.1
  });

  assert.equal(rejectionCounts.connectivity, 1);
});

test("generateGlyphSet rejects candidates below the vertical symmetry coverage floor", () => {
  const rejectionCounts = bestEffortRejectionReasons({
    verticalSymmetryCoverageFloor: 1.1
  });

  assert.equal(rejectionCounts["vertical-symmetry-coverage"], 1);
});

test("generateGlyphSet rejects candidates below the horizontal symmetry coverage floor", () => {
  const rejectionCounts = bestEffortRejectionReasons({
    horizontalSymmetryCoverageFloor: 1.1
  });

  assert.equal(rejectionCounts["horizontal-symmetry-coverage"], 1);
});

test("generateGlyphSet rejects candidates below the complexity floor", () => {
  const rejectionCounts = bestEffortRejectionReasons({
    complexityFloor: 1.1
  });

  assert.equal(rejectionCounts["complexity-floor"], 1);
});

test("generateGlyphSet rejects candidates above the complexity ceiling", () => {
  const rejectionCounts = bestEffortRejectionReasons({
    complexityCeiling: -0.1
  });

  assert.equal(rejectionCounts["complexity-ceiling"], 1);
});

test("generateGlyphSet warns when the best set misses minRepeatedGlyphCount", () => {
  const { grammar } = induceSetGrammar({
    solo: "R"
  });

  grammar.setPriors.diversity = {
    ...grammar.setPriors.diversity,
    minRepeatedGlyphCount: 1
  };

  const result = generateGlyphSet({
    grammar,
    seed: "repetition-warning",
    maxAttemptsPerGlyph: 4,
    maxSetAttempts: 1
  });

  assert.equal(result.setDiagnostics.repeatedGlyphCount, 0);
  assert.equal(result.setDiagnostics.meetsMinRepeatedGlyphCount, false);
  assert(result.setDiagnostics.warnings.includes("below-min-repeated-glyph-count"));
});

test("generateGlyphSet prefers a set that satisfies minRepeatedGlyphCount over one that does not", () => {
  const { grammar } = induceSetGrammar({
    a: "R",
    b: "T",
    c: "C",
    d: "S17"
  });

  grammar.setPriors.diversity = {
    ...grammar.setPriors.diversity,
    maxRepeatedStructureCount: 10,
    minRepeatedGlyphCount: 3
  };

  const singleAttempt = generateGlyphSet({
    grammar,
    seed: "repeat-2",
    maxAttemptsPerGlyph: 20,
    maxSetAttempts: 1
  });
  const multiAttempt = generateGlyphSet({
    grammar,
    seed: "repeat-2",
    maxAttemptsPerGlyph: 20,
    maxSetAttempts: 2
  });

  assert.equal(singleAttempt.setDiagnostics.meetsMinRepeatedGlyphCount, false);
  assert.equal(singleAttempt.setDiagnostics.repeatedGlyphCount, 2);
  assert.equal(multiAttempt.setDiagnostics.meetsMinRepeatedGlyphCount, true);
  assert.equal(multiAttempt.setDiagnostics.repeatedGlyphCount, 3);
});

test("a grammar induced from a built-in set can generate without source access", () => {
  const { grammar } = induceSetGrammar("phoenician");
  const roundTrippedGrammar = JSON.parse(JSON.stringify(grammar));
  const result = generateGlyphSet({ grammar: roundTrippedGrammar, seed: "phoenician-roundtrip" });

  assert.equal(Object.keys(result.definitions).length, grammar.setPriors.slotOrder.length);

  Object.values(result.definitions).forEach((definition) => {
    assert.doesNotThrow(() => compileGlyphDefinition(definition));
  });
});

test("generateGlyphSet returns best-effort results with warnings for impossible thresholds", () => {
  const { grammar } = induceSetGrammar({
    solo: "R"
  });
  const impossibleGrammar = structuredClone(grammar);

  impossibleGrammar.setPriors.acceptance = {
    overallScoreFloor: 1.1,
    slotFitFloor: 1.1
  };

  const result = generateGlyphSet({
    grammar: impossibleGrammar,
    seed: "impossible",
    maxAttemptsPerGlyph: 6,
    maxSetAttempts: 1
  });

  assert(result.setDiagnostics.warnings.includes("returned-best-effort-set"));
  assert(result.glyphs.solo.warnings.includes("accepted-best-effort-candidate"));
});
