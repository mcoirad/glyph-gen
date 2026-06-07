import {
  DEFAULT_SIZE,
  parseGlyphDefinition
} from "./glyph-core.mjs";
import {
  DEFAULT_GLYPH_SET,
  futhorcGlyphs,
  getGlyphDefinitions,
  glyphSets,
  phoenicianGlyphs,
  romanGlyphs
} from "./glyph-definitions.mjs";
import {
  DEFAULT_SET_GRAMMAR_DEFAULTS,
  generateGlyphSet,
  induceSetGrammar,
  validateSetGrammar
} from "./glyph-generate.mjs";
import { renderGlyphNode } from "./glyph-render.mjs";
import { scoreGlyph } from "./glyph-score.mjs";
import {
  buildGeneratedDiagnostics,
  buildGenerationRequest,
  createGenerationSeed,
  createInitialWorkspaceState,
  markGenerationPending,
  setActiveWorkspaceTab,
  storeGenerationError,
  storeGeneratedResult
} from "./glyph-workspace.mjs";

const existingCanvasRoot = document.querySelector("#existing-canvas");
const generatedCanvasRoot = document.querySelector("#generated-canvas");
const existingDraw = SVG().addTo(existingCanvasRoot).size(600, 600);
const generatedDraw = SVG().addTo(generatedCanvasRoot).size(600, 600);
const tabButtons = [...document.querySelectorAll("[data-tab-target]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const glyphSetInput = document.querySelector("#glyph-set");
const generatedSourceSetInput = document.querySelector("#generated-source-set");
const generationSeedInput = document.querySelector("#generation-seed");
const maxAttemptsPerGlyphInput = document.querySelector("#max-attempts-per-glyph");
const maxSetAttemptsInput = document.querySelector("#max-set-attempts");
const generateSetButton = document.querySelector("#generate-set");
const generatedDiagnosticsTitle = document.querySelector("#generated-diagnostics-title");
const generatedStatus = document.querySelector("#generated-status");
const generatedSummary = document.querySelector("#generated-summary");
const generatedWarnings = document.querySelector("#generated-warnings");
const profileInput = document.querySelector("#brush-profile");
const segmentAngleInput = document.querySelector("#segment-angle");
const segmentAngleValue = document.querySelector("#segment-angle-value");
const segmentLengthInput = document.querySelector("#segment-length");
const segmentLengthValue = document.querySelector("#segment-length-value");
const circleDiameterInput = document.querySelector("#circle-diameter");
const circleDiameterValue = document.querySelector("#circle-diameter-value");
const circleTaperStartInput = document.querySelector("#circle-taper-start");
const circleTaperStartValue = document.querySelector("#circle-taper-start-value");
const circleTaperEndInput = document.querySelector("#circle-taper-end");
const circleTaperEndValue = document.querySelector("#circle-taper-end-value");
const rectangleAngleInput = document.querySelector("#rectangle-angle");
const rectangleAngleValue = document.querySelector("#rectangle-angle-value");
const rectangleWidthInput = document.querySelector("#rectangle-width");
const rectangleWidthValue = document.querySelector("#rectangle-width-value");
const rectangleHeightInput = document.querySelector("#rectangle-height");
const rectangleHeightValue = document.querySelector("#rectangle-height-value");
const controlGroups = document.querySelectorAll("[data-profile-controls]");

const glyphSetLabels = {
  phoenician: "Phoenician",
  futhorc: "Futhorc",
  roman: "Roman"
};

let workspaceState = createInitialWorkspaceState({
  defaultGlyphSet: DEFAULT_GLYPH_SET,
  generationDefaults: DEFAULT_SET_GRAMMAR_DEFAULTS,
  initialSeed: createGenerationSeed()
});

const brushState = {
  mode: "brush",
  brush: {
    color: "#18212b",
    profile: {
      kind: "segment",
      angle: 30,
      length: 8
    }
  },
  profiles: {
    segment: {
      kind: "segment",
      angle: 30,
      length: 8
    },
    circle: {
      kind: "circle",
      diameter: 8,
      taperStart: 0,
      taperEnd: 0
    },
    rectangle: {
      kind: "rectangle",
      angle: 30,
      width: 10,
      height: 4
    }
  }
};

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

function formatControlValue(value) {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatScoreValue(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return Number(value).toFixed(2);
}

function applyActiveProfile() {
  const activeProfile = brushState.profiles[brushState.brush.profile.kind];
  brushState.brush.profile = cloneProfile(activeProfile);
}

function syncBrushControls() {
  const activeKind = brushState.brush.profile.kind;
  const segment = brushState.profiles.segment;
  const circle = brushState.profiles.circle;
  const rectangle = brushState.profiles.rectangle;

  profileInput.value = activeKind;

  segmentAngleInput.value = String(segment.angle);
  segmentAngleValue.textContent = `${formatControlValue(segment.angle)}°`;
  segmentLengthInput.value = String(segment.length);
  segmentLengthValue.textContent = formatControlValue(segment.length);

  circleDiameterInput.value = String(circle.diameter);
  circleDiameterValue.textContent = formatControlValue(circle.diameter);
  circleTaperStartInput.value = String(circle.taperStart * 100);
  circleTaperStartValue.textContent = `${Math.round(circle.taperStart * 100)}%`;
  circleTaperEndInput.value = String(circle.taperEnd * 100);
  circleTaperEndValue.textContent = `${Math.round(circle.taperEnd * 100)}%`;

  rectangleAngleInput.value = String(rectangle.angle);
  rectangleAngleValue.textContent = `${formatControlValue(rectangle.angle)}°`;
  rectangleWidthInput.value = String(rectangle.width);
  rectangleWidthValue.textContent = formatControlValue(rectangle.width);
  rectangleHeightInput.value = String(rectangle.height);
  rectangleHeightValue.textContent = formatControlValue(rectangle.height);

  controlGroups.forEach((group) => {
    group.hidden = group.dataset.profileControls !== activeKind;
  });
}

function syncWorkspaceControls() {
  glyphSetInput.value = workspaceState.existing.glyphSetName;
  generatedSourceSetInput.value = workspaceState.generation.sourceSetName;
  generationSeedInput.value = workspaceState.generation.seed;
  maxAttemptsPerGlyphInput.value = String(workspaceState.generation.maxAttemptsPerGlyph);
  maxSetAttemptsInput.value = String(workspaceState.generation.maxSetAttempts);
  generateSetButton.disabled = workspaceState.generation.isGenerating;
  generateSetButton.textContent = workspaceState.generation.isGenerating ? "Generating…" : "Generate Set";
}

function renderTabPanels() {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === workspaceState.activeTab;
    button.classList.toggle("workspace-tab--active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== workspaceState.activeTab;
  });
}

function populateGlyphSetOptions() {
  const options = Object.keys(glyphSets).map((setName) => {
    const option = document.createElement("option");
    option.value = setName;
    option.textContent = glyphSetLabels[setName] || setName;
    return option;
  });

  glyphSetInput.replaceChildren(...options.map((option) => option.cloneNode(true)));
  generatedSourceSetInput.replaceChildren(...options);
}

function attachGlyphTooltip(group, tooltip) {
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = tooltip;
  group.node.prepend(title);
  group.attr({
    "data-glyph-tooltip": "true",
    tabindex: 0
  });
}

function renderEmptyCanvas(draw, canvasRoot, title, message) {
  const width = Math.max(420, Math.floor(canvasRoot.clientWidth || 600));
  const height = 240;

  draw.clear();
  draw.size(width, height);
  draw.rect(width, height)
    .radius(16)
    .fill("rgba(255,255,255,0.72)")
    .stroke({ color: "rgba(24, 33, 43, 0.08)", width: 1 });
  draw.text(title)
    .font({ size: 22, family: "IBM Plex Mono, monospace", weight: 500, anchor: "middle" })
    .center(width / 2, 90);
  draw.text(message)
    .font({ size: 14, family: "IBM Plex Mono, monospace", anchor: "middle" })
    .fill("#4f6478")
    .leading(1.6)
    .center(width / 2, 138);
}

function renderGlyphTable(draw, canvasRoot, glyphEntries, tooltipBuilder, emptyState) {
  if (glyphEntries.length === 0) {
    renderEmptyCanvas(draw, canvasRoot, emptyState.title, emptyState.message);
    return;
  }

  const cellSize = DEFAULT_SIZE;
  const spacing = 30;
  const labelHeight = 20;
  const labelOffset = 12;
  const effectiveSize = cellSize + spacing + labelHeight;
  const topInset = 20;
  const bottomInset = 20;
  const trackWidth = cellSize + spacing;
  const availableWidth = Math.max(trackWidth, Math.floor(canvasRoot.clientWidth || 600));
  const perRow = Math.max(1, Math.floor((availableWidth + spacing) / trackWidth));
  const rows = Math.ceil(glyphEntries.length / perRow);
  const width = perRow * trackWidth;
  const height = rows * effectiveSize + topInset + bottomInset;

  draw.clear();
  draw.size(width, height);

  glyphEntries.forEach(({ name, definition, glyphData }, index) => {
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    const gx = col * trackWidth + cellSize / 2;
    const gy = topInset + row * effectiveSize + cellSize / 2;
    const glyph = parseGlyphDefinition(definition);
    const group = draw.group().translate(gx, gy);

    renderGlyphNode(glyph, group, {
      targetWidth: cellSize,
      targetHeight: cellSize,
      mode: brushState.mode,
      brush: brushState.brush
    });
    attachGlyphTooltip(group, tooltipBuilder(name, definition, glyphData));

    draw.text(name)
      .font({ size: 14, family: "IBM Plex Mono, monospace", anchor: "middle" })
      .center(gx, gy + (cellSize / 2) + labelOffset);
  });
}

function buildExistingGlyphTooltip(name, definition) {
  const result = scoreGlyph(definition);

  return [
    name,
    `definition: ${definition}`,
    `overall: ${formatScoreValue(result.overall)}`,
    `vertical symmetry: ${formatScoreValue(result.scores.verticalSymmetry)}`,
    `horizontal symmetry: ${formatScoreValue(result.scores.horizontalSymmetry)}`,
    `vertical symmetry coverage: ${formatScoreValue(result.scores.verticalSymmetryCoverage)}`,
    `horizontal symmetry coverage: ${formatScoreValue(result.scores.horizontalSymmetryCoverage)}`,
    `connectivity: ${formatScoreValue(result.scores.connectivity)}`,
    `density: ${formatScoreValue(result.scores.density)}`,
    `balance: ${formatScoreValue(result.scores.balance)}`,
    `complexity: ${formatScoreValue(result.scores.complexity)}`,
    `components: ${result.metrics.componentCount}`,
    `dangling endpoints: ${result.metrics.danglingEndpointCount}`,
    `near misses: ${result.metrics.nearMissCount}`
  ].join("\n");
}

function formatRejectionCounts(rejectionCounts = {}) {
  const entries = Object.entries(rejectionCounts).filter(([, count]) => count > 0);

  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([reason, count]) => `${reason} (${count})`).join(", ");
}

function buildGeneratedGlyphTooltip(name, definition, glyphData = {}) {
  return [
    name,
    `definition: ${definition}`,
    `accepted: ${glyphData.accepted ? "yes" : "best effort"}`,
    `overall: ${formatScoreValue(glyphData.overall)}`,
    `slot fit: ${formatScoreValue(glyphData.slotFit)}`,
    `novelty: ${formatScoreValue(glyphData.novelty)}`,
    `attempts: ${glyphData.attemptCount ?? "—"}`,
    `vertical symmetry: ${formatScoreValue(glyphData.scores?.verticalSymmetry)}`,
    `horizontal symmetry: ${formatScoreValue(glyphData.scores?.horizontalSymmetry)}`,
    `vertical symmetry coverage: ${formatScoreValue(glyphData.scores?.verticalSymmetryCoverage)}`,
    `horizontal symmetry coverage: ${formatScoreValue(glyphData.scores?.horizontalSymmetryCoverage)}`,
    `connectivity: ${formatScoreValue(glyphData.scores?.connectivity)}`,
    `density: ${formatScoreValue(glyphData.scores?.density)}`,
    `balance: ${formatScoreValue(glyphData.scores?.balance)}`,
    `complexity: ${formatScoreValue(glyphData.scores?.complexity)}`,
    `components: ${glyphData.metrics?.componentCount ?? "—"}`,
    `dangling endpoints: ${glyphData.metrics?.danglingEndpointCount ?? "—"}`,
    `near misses: ${glyphData.metrics?.nearMissCount ?? "—"}`,
    `warnings: ${(glyphData.warnings || []).join(", ") || "none"}`,
    `rejections: ${formatRejectionCounts(glyphData.rejectionCounts)}`
  ].join("\n");
}

function renderExistingGlyphTable() {
  const glyphEntries = Object.entries(getGlyphDefinitions(workspaceState.existing.glyphSetName))
    .map(([name, definition]) => ({
      name,
      definition
    }));

  renderGlyphTable(existingDraw, existingCanvasRoot, glyphEntries, buildExistingGlyphTooltip, {
    title: "Existing Glyph Sets",
    message: "Choose one of the built-in alphabets to inspect its source forms."
  });
}

function renderGeneratedGlyphTable() {
  if (!workspaceState.generation.currentResult) {
    renderGlyphTable(generatedDraw, generatedCanvasRoot, [], buildGeneratedGlyphTooltip, {
      title: "Generated Glyph Sets",
      message: "Run the generator to render a synthetic sibling alphabet here."
    });
    return;
  }

  const glyphEntries = Object.entries(workspaceState.generation.currentResult.definitions)
    .map(([name, definition]) => ({
      name,
      definition,
      glyphData: workspaceState.generation.currentResult.glyphs[name]
    }));

  renderGlyphTable(generatedDraw, generatedCanvasRoot, glyphEntries, buildGeneratedGlyphTooltip, {
    title: "Generated Glyph Sets",
    message: "Run the generator to render a synthetic sibling alphabet here."
  });
}

function renderGeneratedDiagnostics() {
  const diagnostics = buildGeneratedDiagnostics(workspaceState, glyphSetLabels);

  generatedDiagnosticsTitle.textContent = diagnostics.title;
  generatedStatus.textContent = diagnostics.status;
  generatedSummary.replaceChildren(...diagnostics.summaryItems.map((item) => {
    const article = document.createElement("article");
    const label = document.createElement("span");
    const value = document.createElement("strong");

    article.className = "diagnostics-card";
    label.className = "diagnostics-card__label";
    value.className = "diagnostics-card__value";
    label.textContent = item.label;
    value.textContent = item.value;
    article.append(label, value);
    return article;
  }));
  generatedWarnings.replaceChildren(...diagnostics.warnings.map((warning) => {
    const item = document.createElement("li");
    item.className = "diagnostics-warning";
    item.textContent = warning;
    return item;
  }));
}

function renderWorkspace() {
  syncWorkspaceControls();
  renderTabPanels();
  renderExistingGlyphTable();
  renderGeneratedGlyphTable();
  renderGeneratedDiagnostics();
}

function rerenderGlyphTables() {
  renderExistingGlyphTable();
  renderGeneratedGlyphTable();
}

function runGeneration() {
  const request = buildGenerationRequest(workspaceState);
  workspaceState = markGenerationPending(workspaceState);
  renderWorkspace();

  window.requestAnimationFrame(() => {
    try {
      const { grammar } = induceSetGrammar(request.source);
      validateSetGrammar(grammar);
      const result = generateGlyphSet({
        grammar,
        seed: request.seed,
        maxAttemptsPerGlyph: request.maxAttemptsPerGlyph,
        maxSetAttempts: request.maxSetAttempts
      });

      workspaceState = storeGeneratedResult(workspaceState, result, request);
    } catch (error) {
      workspaceState = storeGenerationError(
        workspaceState,
        error instanceof Error ? error.message : String(error)
      );
    }

    renderWorkspace();
  });
}

function updateBrushFromActiveProfile() {
  applyActiveProfile();
  syncBrushControls();
  rerenderGlyphTables();
}

window.GlyphGen = {
  DEFAULT_SIZE,
  futhorcGlyphs,
  getGlyphDefinitions,
  glyphSets,
  induceSetGrammar,
  parseGlyphDefinition,
  phoenicianGlyphs,
  romanGlyphs,
  validateSetGrammar,
  generateGlyphSet,
  renderWorkspace,
  runGeneration
};

Object.defineProperties(window.GlyphGen, {
  activeGlyphSetName: {
    enumerable: true,
    get() {
      return workspaceState.existing.glyphSetName;
    }
  },
  activeGlyphs: {
    enumerable: true,
    get() {
      return getGlyphDefinitions(workspaceState.existing.glyphSetName);
    }
  },
  generatedResult: {
    enumerable: true,
    get() {
      return workspaceState.generation.currentResult;
    }
  },
  workspaceState: {
    enumerable: true,
    get() {
      return workspaceState;
    }
  },
  brushState: {
    enumerable: true,
    get() {
      return brushState;
    }
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    workspaceState = setActiveWorkspaceTab(workspaceState, button.dataset.tabTarget);
    renderTabPanels();
  });
});

glyphSetInput.addEventListener("input", () => {
  workspaceState = {
    ...workspaceState,
    existing: {
      ...workspaceState.existing,
      glyphSetName: glyphSetInput.value
    }
  };
  renderExistingGlyphTable();
});

generatedSourceSetInput.addEventListener("input", () => {
  workspaceState = {
    ...workspaceState,
    generation: {
      ...workspaceState.generation,
      sourceSetName: generatedSourceSetInput.value
    }
  };
  syncWorkspaceControls();
  renderGeneratedDiagnostics();
});

generationSeedInput.addEventListener("input", () => {
  workspaceState = {
    ...workspaceState,
    generation: {
      ...workspaceState.generation,
      seed: generationSeedInput.value || createGenerationSeed()
    }
  };
  syncWorkspaceControls();
  renderGeneratedDiagnostics();
});

maxAttemptsPerGlyphInput.addEventListener("input", () => {
  workspaceState = {
    ...workspaceState,
    generation: {
      ...workspaceState.generation,
      maxAttemptsPerGlyph: Math.max(
        1,
        Number.parseInt(maxAttemptsPerGlyphInput.value, 10) || DEFAULT_SET_GRAMMAR_DEFAULTS.maxAttemptsPerGlyph
      )
    }
  };
  syncWorkspaceControls();
});

maxSetAttemptsInput.addEventListener("input", () => {
  workspaceState = {
    ...workspaceState,
    generation: {
      ...workspaceState.generation,
      maxSetAttempts: Math.max(
        1,
        Number.parseInt(maxSetAttemptsInput.value, 10) || DEFAULT_SET_GRAMMAR_DEFAULTS.maxSetAttempts
      )
    }
  };
  syncWorkspaceControls();
});

generateSetButton.addEventListener("click", runGeneration);

profileInput.addEventListener("input", () => {
  brushState.brush.profile.kind = profileInput.value;
  updateBrushFromActiveProfile();
});

segmentAngleInput.addEventListener("input", () => {
  brushState.profiles.segment.angle = Number.parseFloat(segmentAngleInput.value);
  updateBrushFromActiveProfile();
});

segmentLengthInput.addEventListener("input", () => {
  brushState.profiles.segment.length = Number.parseFloat(segmentLengthInput.value);
  updateBrushFromActiveProfile();
});

circleDiameterInput.addEventListener("input", () => {
  brushState.profiles.circle.diameter = Number.parseFloat(circleDiameterInput.value);
  updateBrushFromActiveProfile();
});

circleTaperStartInput.addEventListener("input", () => {
  brushState.profiles.circle.taperStart = Number.parseFloat(circleTaperStartInput.value) / 100;
  updateBrushFromActiveProfile();
});

circleTaperEndInput.addEventListener("input", () => {
  brushState.profiles.circle.taperEnd = Number.parseFloat(circleTaperEndInput.value) / 100;
  updateBrushFromActiveProfile();
});

rectangleAngleInput.addEventListener("input", () => {
  brushState.profiles.rectangle.angle = Number.parseFloat(rectangleAngleInput.value);
  updateBrushFromActiveProfile();
});

rectangleWidthInput.addEventListener("input", () => {
  brushState.profiles.rectangle.width = Number.parseFloat(rectangleWidthInput.value);
  updateBrushFromActiveProfile();
});

rectangleHeightInput.addEventListener("input", () => {
  brushState.profiles.rectangle.height = Number.parseFloat(rectangleHeightInput.value);
  updateBrushFromActiveProfile();
});

window.addEventListener("resize", rerenderGlyphTables);

populateGlyphSetOptions();
applyActiveProfile();
syncBrushControls();
renderWorkspace();
