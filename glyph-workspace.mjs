import { induceSetGrammar } from "./glyph-generate.mjs";

function clampInteger(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return parsed;
}

export function createGenerationSeed(now = new Date()) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `run-${iso}`;
}

export function createInitialWorkspaceState({
  defaultGlyphSet,
  generationDefaults,
  initialSeed
}) {
  return {
    activeTab: "existing",
    existing: {
      glyphSetName: defaultGlyphSet
    },
    generation: {
      sourceSetName: defaultGlyphSet,
      sourceDraftsBySetName: {},
      showSlotSettings: false,
      seed: initialSeed,
      maxAttemptsPerGlyph: generationDefaults.maxAttemptsPerGlyph,
      maxSetAttempts: generationDefaults.maxSetAttempts,
      isGenerating: false,
      currentResult: null,
      lastRequest: null,
      error: null
    }
  };
}

function cloneValue(value) {
  return structuredClone(value);
}

function createSourceGrammarDraft(sourceSetName) {
  const { grammar } = induceSetGrammar(sourceSetName);
  return {
    baseGrammar: grammar,
    editedGrammar: cloneValue(grammar),
    isDirty: false
  };
}

function computeDraftDirty(baseGrammar, editedGrammar) {
  return JSON.stringify(baseGrammar) !== JSON.stringify(editedGrammar);
}

function resolveSourceDraft(state, sourceSetName) {
  return state.generation.sourceDraftsBySetName[sourceSetName] || createSourceGrammarDraft(sourceSetName);
}

function storeSourceDraft(state, sourceSetName, draft) {
  return {
    ...state,
    generation: {
      ...state.generation,
      sourceDraftsBySetName: {
        ...state.generation.sourceDraftsBySetName,
        [sourceSetName]: draft
      }
    }
  };
}

export function setActiveWorkspaceTab(state, activeTab) {
  return {
    ...state,
    activeTab
  };
}

export function ensureGenerationSourceDraft(state, sourceSetName = state.generation.sourceSetName) {
  if (state.generation.sourceDraftsBySetName[sourceSetName]) {
    return state;
  }

  return storeSourceDraft(state, sourceSetName, createSourceGrammarDraft(sourceSetName));
}

export function setGenerationSourceSet(state, sourceSetName) {
  const nextState = ensureGenerationSourceDraft({
    ...state,
    generation: {
      ...state.generation,
      sourceSetName
    }
  }, sourceSetName);

  return nextState;
}

export function setGenerationSlotSettingsVisibility(state, showSlotSettings) {
  return {
    ...state,
    generation: {
      ...state.generation,
      showSlotSettings
    }
  };
}

export function getGenerationSourceDraft(state, sourceSetName = state.generation.sourceSetName) {
  return resolveSourceDraft(state, sourceSetName);
}

export function getEditedGenerationGrammar(state, sourceSetName = state.generation.sourceSetName) {
  return cloneValue(resolveSourceDraft(state, sourceSetName).editedGrammar);
}

export function updateGenerationDraftGlobalSetting(
  state,
  section,
  key,
  value,
  sourceSetName = state.generation.sourceSetName
) {
  const draft = resolveSourceDraft(state, sourceSetName);
  const editedGrammar = cloneValue(draft.editedGrammar);

  editedGrammar.setPriors[section] = {
    ...editedGrammar.setPriors[section],
    [key]: value
  };

  if (section === "acceptance") {
    const acceptance = editedGrammar.setPriors.acceptance;

    if (key === "complexityFloor" && acceptance.complexityFloor > acceptance.complexityCeiling) {
      acceptance.complexityCeiling = acceptance.complexityFloor;
    }

    if (key === "complexityCeiling" && acceptance.complexityFloor > acceptance.complexityCeiling) {
      acceptance.complexityFloor = acceptance.complexityCeiling;
    }
  }

  return storeSourceDraft(state, sourceSetName, {
    ...draft,
    editedGrammar,
    isDirty: computeDraftDirty(draft.baseGrammar, editedGrammar)
  });
}

export function updateGenerationDraftRangeBound(
  state,
  {
    slotKey,
    rangeGroup,
    rangeKey,
    bound,
    value
  },
  sourceSetName = state.generation.sourceSetName
) {
  const draft = resolveSourceDraft(state, sourceSetName);
  const editedGrammar = cloneValue(draft.editedGrammar);
  const slotProfile = editedGrammar.setPriors.slotProfiles[slotKey];

  if (rangeGroup === "overall") {
    slotProfile.ranges.overall[bound] = value;
  } else {
    slotProfile.ranges[rangeGroup][rangeKey][bound] = value;
  }

  return storeSourceDraft(state, sourceSetName, {
    ...draft,
    editedGrammar,
    isDirty: computeDraftDirty(draft.baseGrammar, editedGrammar)
  });
}

export function resetGenerationSourceDraft(state, sourceSetName = state.generation.sourceSetName) {
  const draft = resolveSourceDraft(state, sourceSetName);

  return storeSourceDraft(state, sourceSetName, {
    baseGrammar: draft.baseGrammar,
    editedGrammar: cloneValue(draft.baseGrammar),
    isDirty: false
  });
}

export function buildGenerationRequest(state) {
  const draft = resolveSourceDraft(state, state.generation.sourceSetName);

  return {
    source: state.generation.sourceSetName,
    grammar: cloneValue(draft.editedGrammar),
    seed: state.generation.seed,
    maxAttemptsPerGlyph: clampInteger(
      state.generation.maxAttemptsPerGlyph,
      state.generation.maxAttemptsPerGlyph
    ),
    maxSetAttempts: clampInteger(
      state.generation.maxSetAttempts,
      state.generation.maxSetAttempts
    )
  };
}

export function markGenerationPending(state) {
  return {
    ...state,
    generation: {
      ...state.generation,
      isGenerating: true,
      error: null
    }
  };
}

export function storeGeneratedResult(state, result, request) {
  return {
    ...state,
    generation: {
      ...state.generation,
      isGenerating: false,
      error: null,
      currentResult: result,
      lastRequest: {
        ...request
      }
    }
  };
}

export function storeGenerationError(state, errorMessage) {
  return {
    ...state,
    generation: {
      ...state.generation,
      isGenerating: false,
      error: errorMessage
    }
  };
}

export function buildGeneratedDiagnostics(state, labels = {}) {
  const sourceLabel = labels[state.generation.sourceSetName] || state.generation.sourceSetName;
  const warnings = [];

  if (state.generation.error) {
    warnings.push(state.generation.error);
  }

  if (!state.generation.currentResult) {
    return {
      title: "Generated Set",
      status: state.generation.isGenerating
        ? "Generating a sibling alphabet…"
        : "Generate a sibling alphabet from one of the built-in sets.",
      summaryItems: [
        { label: "Source", value: sourceLabel },
        { label: "Seed", value: state.generation.seed },
        { label: "Overrides", value: getGenerationSourceDraft(state).isDirty ? "Edited" : "Derived" }
      ],
      warnings
    };
  }

  const result = state.generation.currentResult;
  const diagnostics = result.setDiagnostics || {};

  return {
    title: "Generated Set",
    status: state.generation.isGenerating
      ? "Generating a new sibling alphabet…"
      : (warnings.length > 0 ? "Showing the last successful generated run." : "Generated sibling alphabet ready."),
    summaryItems: [
      { label: "Source", value: sourceLabel },
      { label: "Seed", value: state.generation.lastRequest?.seed || state.generation.seed },
      { label: "Overrides", value: getGenerationSourceDraft(state).isDirty ? "Edited" : "Derived" },
      { label: "Accepted", value: `${diagnostics.acceptedCount ?? 0}/${diagnostics.totalGlyphs ?? 0}` },
      { label: "Overall Avg", value: formatDecimal(diagnostics.overallAverage) },
      { label: "Slot Fit Avg", value: formatDecimal(diagnostics.slotFitAverage) },
      { label: "Min Novelty", value: formatDecimal(diagnostics.minNovelty) }
    ],
    warnings: [
      ...(diagnostics.warnings || []),
      ...warnings
    ]
  };
}

function formatDecimal(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(2);
}
