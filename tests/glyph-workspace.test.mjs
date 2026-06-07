import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SET_GRAMMAR_DEFAULTS } from "../glyph-generate.mjs";
import {
  buildGeneratedDiagnostics,
  buildGenerationRequest,
  createGenerationSeed,
  createInitialWorkspaceState,
  markGenerationPending,
  setActiveWorkspaceTab,
  storeGenerationError,
  storeGeneratedResult
} from "../glyph-workspace.mjs";

test("createInitialWorkspaceState seeds the generated workspace defaults", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "run-seed"
  });

  assert.equal(state.activeTab, "existing");
  assert.equal(state.existing.glyphSetName, "roman");
  assert.equal(state.generation.sourceSetName, "roman");
  assert.equal(state.generation.seed, "run-seed");
  assert.equal(state.generation.maxAttemptsPerGlyph, DEFAULT_SET_GRAMMAR_DEFAULTS.maxAttemptsPerGlyph);
  assert.equal(state.generation.maxSetAttempts, DEFAULT_SET_GRAMMAR_DEFAULTS.maxSetAttempts);
});

test("setActiveWorkspaceTab switches tabs without disturbing generation settings", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "futhorc",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });
  const nextState = setActiveWorkspaceTab(state, "generated");

  assert.equal(nextState.activeTab, "generated");
  assert.equal(nextState.generation.seed, "seed");
});

test("buildGenerationRequest uses the selected generated-set form values", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "phoenician",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });

  state.generation.sourceSetName = "roman";
  state.generation.seed = "custom-seed";
  state.generation.maxAttemptsPerGlyph = 77;
  state.generation.maxSetAttempts = 5;

  assert.deepEqual(buildGenerationRequest(state), {
    source: "roman",
    seed: "custom-seed",
    maxAttemptsPerGlyph: 77,
    maxSetAttempts: 5
  });
});

test("storeGeneratedResult keeps the current generated run and clears transient errors", () => {
  let state = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });

  state = markGenerationPending(state);
  state = storeGeneratedResult(state, {
    definitions: { a: "R" },
    glyphs: { a: { accepted: true } },
    setDiagnostics: {
      acceptedCount: 1,
      totalGlyphs: 1,
      overallAverage: 0.9,
      slotFitAverage: 0.88,
      minNovelty: 0.12,
      warnings: []
    }
  }, {
    source: "roman",
    seed: "seed",
    maxAttemptsPerGlyph: 20,
    maxSetAttempts: 2
  });

  assert.equal(state.generation.isGenerating, false);
  assert.equal(state.generation.error, null);
  assert.deepEqual(state.generation.currentResult.definitions, { a: "R" });
  assert.equal(state.generation.lastRequest.seed, "seed");
});

test("storeGenerationError preserves the last successful run", () => {
  const initialState = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });
  const withResult = storeGeneratedResult(initialState, {
    definitions: { a: "R" },
    glyphs: { a: { accepted: true } },
    setDiagnostics: {
      acceptedCount: 1,
      totalGlyphs: 1,
      overallAverage: 0.9,
      slotFitAverage: 0.88,
      minNovelty: 0.12,
      warnings: []
    }
  }, {
    source: "roman",
    seed: "seed",
    maxAttemptsPerGlyph: 20,
    maxSetAttempts: 2
  });
  const erroredState = storeGenerationError(withResult, "Generation failed");

  assert.equal(erroredState.generation.error, "Generation failed");
  assert.deepEqual(erroredState.generation.currentResult.definitions, { a: "R" });
});

test("buildGeneratedDiagnostics surfaces current-run summary and warnings", () => {
  const state = storeGenerationError(storeGeneratedResult(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }), {
    definitions: { a: "R" },
    glyphs: { a: { accepted: true } },
    setDiagnostics: {
      acceptedCount: 1,
      totalGlyphs: 1,
      overallAverage: 0.9,
      slotFitAverage: 0.88,
      minNovelty: 0.12,
      warnings: ["returned-best-effort-set"]
    }
  }, {
    source: "roman",
    seed: "seed",
    maxAttemptsPerGlyph: 20,
    maxSetAttempts: 2
  }), "Last generation failed");
  const diagnostics = buildGeneratedDiagnostics(state, {
    roman: "Roman"
  });

  assert.equal(diagnostics.summaryItems[0].value, "Roman");
  assert.equal(diagnostics.summaryItems[1].value, "seed");
  assert(diagnostics.warnings.includes("returned-best-effort-set"));
  assert(diagnostics.warnings.includes("Last generation failed"));
});

test("createGenerationSeed returns a stable timestamp-style seed", () => {
  const seed = createGenerationSeed(new Date("2026-06-07T12:34:56.000Z"));

  assert.equal(seed, "run-2026-06-07T12:34:56Z");
});
