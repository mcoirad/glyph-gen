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
  ensureGenerationSourceDraft,
  getGenerationSourceDraft,
  markGenerationPending,
  resetGenerationSourceDraft,
  setActiveWorkspaceTab,
  setGenerationSlotSettingsVisibility,
  setGenerationSourceSet,
  storeGenerationError,
  storeGeneratedResult,
  updateGenerationDraftGlobalSetting,
  updateGenerationDraftRangeBound
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
const resetSourceSettingsButton = document.querySelector("#reset-source-settings");
const sourceSettingsStatus = document.querySelector("#source-settings-status");
const showSlotSettingsInput = document.querySelector("#show-slot-settings");
const sourceSettingsGlobal = document.querySelector("#source-settings-global");
const sourceSettingsSlots = document.querySelector("#source-settings-slots");
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

const GLOBAL_SETTING_FIELDS = Object.freeze([
  { section: "acceptance", key: "overallScoreFloor", label: "Overall Score Floor", kind: "ratio" },
  { section: "acceptance", key: "slotFitFloor", label: "Slot Fit Floor", kind: "ratio" },
  { section: "acceptance", key: "connectivityFloor", label: "Connectivity Floor", kind: "ratio" },
  { section: "acceptance", key: "verticalSymmetryCoverageFloor", label: "Vertical Symmetry Coverage Floor", kind: "ratio" },
  { section: "acceptance", key: "horizontalSymmetryCoverageFloor", label: "Horizontal Symmetry Coverage Floor", kind: "ratio" },
  { section: "acceptance", key: "complexityFloor", label: "Complexity Floor (0-1)", kind: "ratio" },
  { section: "acceptance", key: "complexityCeiling", label: "Complexity Ceiling (0-1)", kind: "ratio" },
  { section: "diversity", key: "noveltyFloor", label: "Novelty Floor", kind: "ratio" },
  { section: "diversity", key: "featureDistanceFloor", label: "Feature Distance Floor", kind: "ratio" },
  { section: "diversity", key: "maxRepeatedStructureCount", label: "Max Repeated Structures", kind: "count-one" }
]);

const SLOT_RANGE_SECTIONS = Object.freeze([
  {
    title: "Overall",
    rangeGroup: "overall",
    fields: [
      { key: "overall", label: "Overall", kind: "ratio" }
    ]
  },
  {
    title: "Score Ranges",
    rangeGroup: "scores",
    fields: [
      { key: "verticalSymmetry", label: "Vertical Symmetry", kind: "ratio" },
      { key: "horizontalSymmetry", label: "Horizontal Symmetry", kind: "ratio" },
      { key: "connectivity", label: "Connectivity", kind: "ratio" },
      { key: "density", label: "Density", kind: "ratio" },
      { key: "balance", label: "Balance", kind: "ratio" },
      { key: "complexity", label: "Complexity", kind: "ratio" }
    ]
  },
  {
    title: "Metric Ranges",
    rangeGroup: "metrics",
    fields: [
      { key: "segmentCount", label: "Segment Count", kind: "count-one" },
      { key: "componentCount", label: "Component Count", kind: "count-one" },
      { key: "occupiedCellRatio", label: "Occupied Cell Ratio", kind: "ratio" },
      { key: "rowCount", label: "Row Count", kind: "count-one" },
      { key: "columnCount", label: "Column Count", kind: "count-one" },
      { key: "overlayCount", label: "Overlay Count", kind: "count-zero" },
      { key: "primitiveCount", label: "Primitive Count", kind: "count-one" }
    ]
  }
]);

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

const expandedSlotKeys = new Set();

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

function formatEditorValue(value, kind = "ratio") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  if (kind === "ratio") {
    return Number(value.toFixed(3)).toString();
  }

  return String(Math.round(value));
}

function labelForSourceSet(setName) {
  return glyphSetLabels[setName] || setName;
}

function ensureActiveSourceDraft() {
  workspaceState = ensureGenerationSourceDraft(workspaceState);
  return getGenerationSourceDraft(workspaceState);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeEditorValue(rawValue, kind) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return null;
  }

  const parsed = Number.parseFloat(rawValue);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (kind === "ratio") {
    return Number(clamp(parsed, 0, 1).toFixed(3));
  }

  if (kind === "count-zero") {
    return Math.max(0, Math.round(parsed));
  }

  return Math.max(1, Math.round(parsed));
}

function createLabeledNumberInput({
  labelText,
  value,
  kind,
  dataset = {}
}) {
  const field = document.createElement("div");
  const label = document.createElement("label");
  const input = document.createElement("input");

  field.className = "setting-field";
  label.textContent = labelText;
  input.type = "number";
  input.step = kind === "ratio" ? "0.01" : "1";
  input.min = kind === "count-zero" ? "0" : (kind === "ratio" ? "0" : "1");
  if (kind === "ratio") {
    input.max = "1";
  }
  input.value = formatEditorValue(value, kind);
  Object.entries(dataset).forEach(([key, entryValue]) => {
    input.dataset[key] = entryValue;
  });

  field.append(label, input);
  return field;
}

function createTargetChip(labelText, value, kind = "ratio") {
  const article = document.createElement("article");
  const label = document.createElement("span");
  const valueNode = document.createElement("strong");

  article.className = "target-chip";
  label.className = "target-chip__label";
  valueNode.className = "target-chip__value";
  label.textContent = labelText;
  valueNode.textContent = typeof value === "number" ? formatEditorValue(value, kind) : value;
  article.append(label, valueNode);
  return article;
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

function renderSourceSettingsEditor() {
  const draft = ensureActiveSourceDraft();
  const sourceSetName = workspaceState.generation.sourceSetName;
  const grammar = draft.editedGrammar;
  const slotOrder = grammar.setPriors.slotOrder;
  const showSlotSettings = workspaceState.generation.showSlotSettings;

  resetSourceSettingsButton.disabled = !draft.isDirty;
  showSlotSettingsInput.checked = showSlotSettings;
  sourceSettingsStatus.textContent = draft.isDirty
    ? `Editing ${labelForSourceSet(sourceSetName)}-derived generation thresholds. New runs will use these overrides until you reset them.`
    : `Showing source-derived generation thresholds for ${labelForSourceSet(sourceSetName)}. Global acceptance floors control the full run.`;

  const globalGroups = ["acceptance", "diversity"].map((section) => {
    const group = document.createElement("section");
    const heading = document.createElement("h4");
    const grid = document.createElement("div");

    group.className = "source-settings-group";
    heading.textContent = section === "acceptance" ? "Acceptance" : "Diversity";
    grid.className = "source-settings-grid";
    GLOBAL_SETTING_FIELDS
      .filter((field) => field.section === section)
      .forEach((field) => {
        grid.append(createLabeledNumberInput({
          labelText: field.label,
          value: grammar.setPriors[field.section][field.key],
          kind: field.kind,
          dataset: {
            editorType: "global",
            section: field.section,
            key: field.key,
            kind: field.kind
          }
        }));
      });

    group.append(heading, grid);
    return group;
  });

  sourceSettingsGlobal.replaceChildren(...globalGroups);

  const slotCards = slotOrder.map((slotKey, index) => {
    const profile = grammar.setPriors.slotProfiles[slotKey];
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const summaryTitle = document.createElement("strong");
    const summaryMeta = document.createElement("span");
    const content = document.createElement("div");
    const metaHeading = document.createElement("h4");
    const meta = document.createElement("div");
    const targetsHeading = document.createElement("h4");
    const targets = document.createElement("div");
    const targetFields = [
      { label: "Overall", value: profile.target.overall, kind: "ratio" },
      { label: "Vertical Symmetry", value: profile.target.scores.verticalSymmetry, kind: "ratio" },
      { label: "Horizontal Symmetry", value: profile.target.scores.horizontalSymmetry, kind: "ratio" },
      { label: "Vertical Coverage", value: profile.target.scores.verticalSymmetryCoverage, kind: "ratio" },
      { label: "Horizontal Coverage", value: profile.target.scores.horizontalSymmetryCoverage, kind: "ratio" },
      { label: "Connectivity", value: profile.target.scores.connectivity, kind: "ratio" },
      { label: "Density", value: profile.target.scores.density, kind: "ratio" },
      { label: "Balance", value: profile.target.scores.balance, kind: "ratio" },
      { label: "Complexity (0-1)", value: profile.target.scores.complexity, kind: "ratio" },
      { label: "Segment Count", value: profile.target.metrics.segmentCount, kind: "count-one" },
      { label: "Component Count", value: profile.target.metrics.componentCount, kind: "count-one" },
      { label: "Occupied Ratio", value: profile.target.metrics.occupiedCellRatio, kind: "ratio" },
      { label: "Row Count", value: profile.target.metrics.rowCount, kind: "count-one" },
      { label: "Column Count", value: profile.target.metrics.columnCount, kind: "count-one" },
      { label: "Overlay Count", value: profile.target.metrics.overlayCount, kind: "count-zero" },
      { label: "Primitive Count", value: profile.target.metrics.primitiveCount, kind: "count-one" }
    ];

    details.className = "slot-card";
    details.dataset.slotKey = slotKey;
    details.open = expandedSlotKeys.has(slotKey) || (expandedSlotKeys.size === 0 && index === 0);
    details.addEventListener("toggle", () => {
      if (details.open) {
        expandedSlotKeys.add(slotKey);
      } else {
        expandedSlotKeys.delete(slotKey);
      }
    });

    summary.className = "slot-card__summary";
    summaryTitle.textContent = slotKey;
    summaryMeta.textContent = `${profile.modifierTypes.join(", ") || "no modifiers"} • ${profile.structureSignature ? "profile loaded" : "profile missing"}`;
    summary.append(summaryTitle, summaryMeta);

    content.className = "slot-card__content";

    metaHeading.textContent = "Source Context";
    meta.className = "slot-card__meta";
    meta.append(
      createTargetChip("Source Definition", profile.sourceDefinition, "count-one"),
      createTargetChip("Modifier Types", profile.modifierTypes.join(", ") || "none", "count-one")
    );

    targetsHeading.textContent = "Target Values";
    targets.className = "slot-card__targets";
    targetFields.forEach((field) => {
      targets.append(createTargetChip(field.label, field.value, field.kind));
    });

    const ranges = document.createElement("div");
    ranges.className = "slot-card__ranges";

    SLOT_RANGE_SECTIONS.forEach((section) => {
      const sectionNode = document.createElement("section");
      const sectionHeading = document.createElement("h4");

      sectionNode.className = "range-section";
      sectionHeading.textContent = section.title;
      sectionNode.append(sectionHeading);

      section.fields.forEach((field) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        const minInput = document.createElement("input");
        const maxInput = document.createElement("input");
        const range = section.rangeGroup === "overall"
          ? profile.ranges.overall
          : profile.ranges[section.rangeGroup][field.key];

        row.className = "range-row";
        label.className = "range-row__label";
        label.textContent = field.label;

        [minInput, maxInput].forEach((input, inputIndex) => {
          input.type = "number";
          input.step = field.kind === "ratio" ? "0.01" : "1";
          input.min = field.kind === "count-zero" ? "0" : (field.kind === "ratio" ? "0" : "1");
          if (field.kind === "ratio") {
            input.max = "1";
          }
          input.placeholder = inputIndex === 0 ? "Min" : "Max";
          input.dataset.editorType = "range";
          input.dataset.slotKey = slotKey;
          input.dataset.rangeGroup = section.rangeGroup;
          input.dataset.rangeKey = field.key;
          input.dataset.bound = inputIndex === 0 ? "min" : "max";
          input.dataset.kind = field.kind;
          input.setAttribute("aria-label", `${slotKey} ${field.label} ${inputIndex === 0 ? "minimum" : "maximum"}`);
        });

        minInput.value = formatEditorValue(range.min, field.kind);
        maxInput.value = formatEditorValue(range.max, field.kind);
        row.append(label, minInput, maxInput);
        sectionNode.append(row);
      });

      ranges.append(sectionNode);
    });

    content.append(metaHeading, meta, targetsHeading, targets, ranges);
    details.append(summary, content);
    return details;
  });

  sourceSettingsSlots.hidden = !showSlotSettings;
  sourceSettingsSlots.replaceChildren(...(showSlotSettings ? slotCards : []));
}

function renderWorkspace() {
  ensureActiveSourceDraft();
  syncWorkspaceControls();
  renderTabPanels();
  renderExistingGlyphTable();
  renderGeneratedGlyphTable();
  renderGeneratedDiagnostics();
  renderSourceSettingsEditor();
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
      validateSetGrammar(request.grammar);
      const result = generateGlyphSet({
        grammar: request.grammar,
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
  workspaceState = setGenerationSourceSet(workspaceState, generatedSourceSetInput.value);
  renderWorkspace();
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

resetSourceSettingsButton.addEventListener("click", () => {
  workspaceState = resetGenerationSourceDraft(workspaceState);
  renderGeneratedDiagnostics();
  renderSourceSettingsEditor();
});

showSlotSettingsInput.addEventListener("input", () => {
  workspaceState = setGenerationSlotSettingsVisibility(workspaceState, showSlotSettingsInput.checked);
  renderSourceSettingsEditor();
});

function commitGlobalSettingEdit(input) {
  const value = sanitizeEditorValue(input.value, input.dataset.kind);

  if (value === null) {
    renderSourceSettingsEditor();
    return;
  }

  workspaceState = updateGenerationDraftGlobalSetting(
    workspaceState,
    input.dataset.section,
    input.dataset.key,
    value
  );

  renderGeneratedDiagnostics();
  renderSourceSettingsEditor();
}

function commitRangeSettingEdit(input) {
  const value = sanitizeEditorValue(input.value, input.dataset.kind);

  if (value === null) {
    renderSourceSettingsEditor();
    return;
  }

  const draft = getGenerationSourceDraft(workspaceState);
  const profile = draft.editedGrammar.setPriors.slotProfiles[input.dataset.slotKey];
  const range = input.dataset.rangeGroup === "overall"
    ? profile.ranges.overall
    : profile.ranges[input.dataset.rangeGroup][input.dataset.rangeKey];
  const pairedBound = input.dataset.bound === "min" ? "max" : "min";

  workspaceState = updateGenerationDraftRangeBound(workspaceState, {
    slotKey: input.dataset.slotKey,
    rangeGroup: input.dataset.rangeGroup,
    rangeKey: input.dataset.rangeKey,
    bound: input.dataset.bound,
    value
  });

  if ((input.dataset.bound === "min" && value > range.max) || (input.dataset.bound === "max" && value < range.min)) {
    workspaceState = updateGenerationDraftRangeBound(workspaceState, {
      slotKey: input.dataset.slotKey,
      rangeGroup: input.dataset.rangeGroup,
      rangeKey: input.dataset.rangeKey,
      bound: pairedBound,
      value
    });
  }

  renderGeneratedDiagnostics();
  renderSourceSettingsEditor();
}

function handleSourceSettingsChange(event) {
  const input = event.target;

  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.dataset.editorType === "global") {
    commitGlobalSettingEdit(input);
    return;
  }

  if (input.dataset.editorType === "range") {
    commitRangeSettingEdit(input);
  }
}

sourceSettingsGlobal.addEventListener("change", handleSourceSettingsChange);
sourceSettingsSlots.addEventListener("change", handleSourceSettingsChange);

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
