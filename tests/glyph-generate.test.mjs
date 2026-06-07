import test from "node:test";
import assert from "node:assert/strict";

import { compileGlyphDefinition, parseGlyphDefinition } from "../glyph-core.mjs";
import {
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
  assert.equal(typeof diagnostics.uniqueStructureCount, "number");

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(grammar)));
});

test("induceSetGrammar accepts a custom glyph map", () => {
  const { grammar } = induceSetGrammar(CUSTOM_SOURCE);

  assert.equal(grammar.metadata.sourceLabel, "custom");
  assert.deepEqual(grammar.setPriors.slotOrder, ["a", "b", "c", "d"]);
  assert.deepEqual(Object.keys(grammar.setPriors.slotProfiles), ["a", "b", "c", "d"]);
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
  assert.deepEqual(Object.keys(result.definitions), grammar.setPriors.slotOrder);
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
