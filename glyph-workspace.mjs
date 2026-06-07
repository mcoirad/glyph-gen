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

export function setActiveWorkspaceTab(state, activeTab) {
  return {
    ...state,
    activeTab
  };
}

export function buildGenerationRequest(state) {
  return {
    source: state.generation.sourceSetName,
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
        { label: "Seed", value: state.generation.seed }
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
