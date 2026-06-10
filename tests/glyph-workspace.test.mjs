import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SET_GRAMMAR_DEFAULTS,
  validateSetGrammar
} from "../glyph-generate.mjs";
import {
  buildGeneratedDiagnostics,
  buildGenerationRequest,
  createGenerationSeed,
  createInitialWorkspaceState,
  ensureGenerationSourceDraft,
  getGenerationSourceDraft,
  markGenerationPending,
  resetGenerationSourceDraft,
  setActiveWorkspaceTab,
  setGenerationPreviewMode,
  setGenerationSlotSettingsVisibility,
  setGenerationSourceSet,
  storeGenerationError,
  storeGeneratedResult,
  updateGenerationDraftGlobalSetting,
  updateGenerationDraftRangeBound
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
  assert.deepEqual(state.generation.sourceDraftsBySetName, {});
  assert.equal(state.generation.showSlotSettings, false);
  assert.equal(state.generation.previewMode, "ltr");
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

test("setGenerationSlotSettingsVisibility toggles slot editor visibility", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });
  const nextState = setGenerationSlotSettingsVisibility(state, true);

  assert.equal(nextState.generation.showSlotSettings, true);
  assert.equal(state.generation.showSlotSettings, false);
});

test("setGenerationPreviewMode updates preview mode without touching generated result state", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });
  const nextState = setGenerationPreviewMode(state, "ttb");

  assert.equal(nextState.generation.previewMode, "ttb");
  assert.equal(nextState.generation.currentResult, null);
  assert.equal(nextState.generation.seed, "seed");
});

test("buildGenerationRequest uses the selected generated-set form values", () => {
  let state = createInitialWorkspaceState({
    defaultGlyphSet: "phoenician",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });

  state = ensureGenerationSourceDraft(state);
  state.generation.sourceSetName = "roman";
  state.generation.seed = "custom-seed";
  state.generation.maxAttemptsPerGlyph = 77;
  state.generation.maxSetAttempts = 5;
  state = ensureGenerationSourceDraft(state, "roman");
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "overallScoreFloor", 0.73, "roman");
  state = updateGenerationDraftGlobalSetting(state, "diversity", "minRepeatedGlyphCount", 4, "roman");

  const request = buildGenerationRequest(state);

  assert.equal(request.source, "roman");
  assert.equal(request.seed, "custom-seed");
  assert.equal(request.maxAttemptsPerGlyph, 77);
  assert.equal(request.maxSetAttempts, 5);
  assert.equal(request.grammar.setPriors.acceptance.overallScoreFloor, 0.73);
  assert.equal(request.grammar.setPriors.diversity.minRepeatedGlyphCount, 4);
});

test("ensureGenerationSourceDraft lazily initializes the selected source draft", () => {
  const state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));
  const draft = getGenerationSourceDraft(state);

  assert.equal(draft.isDirty, false);
  assert.equal(draft.baseGrammar.metadata.sourceLabel, "roman");
  assert.deepEqual(draft.baseGrammar, draft.editedGrammar);
});

test("setGenerationSourceSet restores drafts independently per source set", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "overallScoreFloor", 0.71);
  state = setGenerationSourceSet(state, "phoenician");
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "overallScoreFloor", 0.55);
  state = setGenerationSourceSet(state, "roman");

  assert.equal(getGenerationSourceDraft(state).editedGrammar.setPriors.acceptance.overallScoreFloor, 0.71);
  assert.equal(getGenerationSourceDraft(state, "phoenician").editedGrammar.setPriors.acceptance.overallScoreFloor, 0.55);
});

test("updateGenerationDraftGlobalSetting mutates the active draft path", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "diversity", "featureDistanceFloor", 0.19);

  assert.equal(getGenerationSourceDraft(state).editedGrammar.setPriors.diversity.featureDistanceFloor, 0.19);
  assert.equal(getGenerationSourceDraft(state).isDirty, true);
});

test("updateGenerationDraftGlobalSetting can store the new minRepeatedGlyphCount diversity field", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "diversity", "minRepeatedGlyphCount", 3);

  assert.equal(getGenerationSourceDraft(state).editedGrammar.setPriors.diversity.minRepeatedGlyphCount, 3);
});

test("updateGenerationDraftGlobalSetting can store the new acceptance floor fields", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "connectivityFloor", 0.66);
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "verticalSymmetryCoverageFloor", 0.52);
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "horizontalSymmetryCoverageFloor", 0.47);
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "complexityFloor", 0.2);
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "complexityCeiling", 0.8);

  const acceptance = getGenerationSourceDraft(state).editedGrammar.setPriors.acceptance;
  assert.equal(acceptance.connectivityFloor, 0.66);
  assert.equal(acceptance.verticalSymmetryCoverageFloor, 0.52);
  assert.equal(acceptance.horizontalSymmetryCoverageFloor, 0.47);
  assert.equal(acceptance.complexityFloor, 0.2);
  assert.equal(acceptance.complexityCeiling, 0.8);
});

test("updateGenerationDraftGlobalSetting reconciles invalid complexity floor and ceiling ordering", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "complexityCeiling", 0.4);
  state = updateGenerationDraftGlobalSetting(state, "acceptance", "complexityFloor", 0.7);

  let acceptance = getGenerationSourceDraft(state).editedGrammar.setPriors.acceptance;
  assert.equal(acceptance.complexityFloor, 0.7);
  assert.equal(acceptance.complexityCeiling, 0.7);

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "complexityCeiling", 0.2);

  acceptance = getGenerationSourceDraft(state).editedGrammar.setPriors.acceptance;
  assert.equal(acceptance.complexityFloor, 0.2);
  assert.equal(acceptance.complexityCeiling, 0.2);
});

test("updateGenerationDraftRangeBound mutates the correct slot range field", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));
  const slotKey = getGenerationSourceDraft(state).editedGrammar.setPriors.slotOrder[0];

  state = updateGenerationDraftRangeBound(state, {
    slotKey,
    rangeGroup: "scores",
    rangeKey: "density",
    bound: "min",
    value: 0.31
  });

  assert.equal(getGenerationSourceDraft(state).editedGrammar.setPriors.slotProfiles[slotKey].ranges.scores.density.min, 0.31);
});

test("resetGenerationSourceDraft restores the source-derived grammar", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "slotFitFloor", 0.91);
  state = resetGenerationSourceDraft(state);

  const draft = getGenerationSourceDraft(state);
  assert.equal(draft.isDirty, false);
  assert.deepEqual(draft.baseGrammar, draft.editedGrammar);
  assert.doesNotThrow(() => validateSetGrammar(draft.editedGrammar));
});

test("slot editor visibility does not disturb stored slot draft edits", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));
  const slotKey = getGenerationSourceDraft(state).editedGrammar.setPriors.slotOrder[0];

  state = updateGenerationDraftRangeBound(state, {
    slotKey,
    rangeGroup: "scores",
    rangeKey: "density",
    bound: "max",
    value: 0.73
  });
  state = setGenerationSlotSettingsVisibility(state, true);
  state = setGenerationSlotSettingsVisibility(state, false);

  assert.equal(getGenerationSourceDraft(state).editedGrammar.setPriors.slotProfiles[slotKey].ranges.scores.density.max, 0.73);
  assert.equal(state.generation.showSlotSettings, false);
});

test("edited drafts remain valid serializable grammars", () => {
  let state = ensureGenerationSourceDraft(createInitialWorkspaceState({
    defaultGlyphSet: "phoenician",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  }));
  const slotKey = getGenerationSourceDraft(state).editedGrammar.setPriors.slotOrder[0];

  state = updateGenerationDraftGlobalSetting(state, "acceptance", "overallScoreFloor", 0.68);
  state = updateGenerationDraftRangeBound(state, {
    slotKey,
    rangeGroup: "metrics",
    rangeKey: "primitiveCount",
    bound: "max",
    value: 6
  });

  assert.doesNotThrow(() => validateSetGrammar(getGenerationSourceDraft(state).editedGrammar));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(getGenerationSourceDraft(state).editedGrammar)));
});

test("buildGenerationRequest falls back to a derived grammar when no draft was initialized", () => {
  const state = createInitialWorkspaceState({
    defaultGlyphSet: "roman",
    generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
    initialSeed: "seed"
  });
  const request = buildGenerationRequest(state);

  assert.equal(request.source, "roman");
  assert.equal(request.grammar.metadata.sourceLabel, "roman");
  assert.doesNotThrow(() => validateSetGrammar(request.grammar));
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
    katakana: "Katakana",
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
