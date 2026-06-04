import {
  DEFAULT_SIZE,
  parseGlyphDefinition
} from "./glyph-core.mjs";
import { phoenicianGlyphs } from "./glyph-definitions.mjs";
import { renderGlyphNode } from "./glyph-render.mjs";

const draw = SVG().addTo("#canvas").size(600, 600);
const profileInput = document.querySelector("#brush-profile");
const segmentAngleInput = document.querySelector("#segment-angle");
const segmentAngleValue = document.querySelector("#segment-angle-value");
const segmentLengthInput = document.querySelector("#segment-length");
const segmentLengthValue = document.querySelector("#segment-length-value");
const circleDiameterInput = document.querySelector("#circle-diameter");
const circleDiameterValue = document.querySelector("#circle-diameter-value");
const rectangleAngleInput = document.querySelector("#rectangle-angle");
const rectangleAngleValue = document.querySelector("#rectangle-angle-value");
const rectangleWidthInput = document.querySelector("#rectangle-width");
const rectangleWidthValue = document.querySelector("#rectangle-width-value");
const rectangleHeightInput = document.querySelector("#rectangle-height");
const rectangleHeightValue = document.querySelector("#rectangle-height-value");
const controlGroups = document.querySelectorAll("[data-profile-controls]");
const previewState = {
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
      diameter: 8
    },
    rectangle: {
      kind: "rectangle",
      angle: 30,
      width: 10,
      height: 4
    }
  }
};

function formatControlValue(value) {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile));
}

function applyActiveProfile() {
  const activeProfile = previewState.profiles[previewState.brush.profile.kind];
  previewState.brush.profile = cloneProfile(activeProfile);
}

function syncControls() {
  const activeKind = previewState.brush.profile.kind;
  const segment = previewState.profiles.segment;
  const circle = previewState.profiles.circle;
  const rectangle = previewState.profiles.rectangle;

  profileInput.value = activeKind;

  segmentAngleInput.value = String(segment.angle);
  segmentAngleValue.textContent = `${formatControlValue(segment.angle)}°`;
  segmentLengthInput.value = String(segment.length);
  segmentLengthValue.textContent = formatControlValue(segment.length);

  circleDiameterInput.value = String(circle.diameter);
  circleDiameterValue.textContent = formatControlValue(circle.diameter);

  rectangleAngleInput.value = String(rectangle.angle);
  rectangleAngleValue.textContent = `${formatControlValue(rectangle.angle)}°`;
  rectangleWidthInput.value = String(rectangle.width);
  rectangleWidthValue.textContent = formatControlValue(rectangle.width);
  rectangleHeightInput.value = String(rectangle.height);
  rectangleHeightValue.textContent = formatControlValue(rectangle.height);

  controlGroups.forEach((group) => {
    const matches = group.dataset.profileControls === activeKind;
    group.hidden = !matches;
  });
}

function renderGlyphTable() {
  const cellSize = DEFAULT_SIZE;
  const spacing = 30;
  const labelHeight = 20;
  const effectiveSize = cellSize + spacing + labelHeight;
  const perRow = 6;
  const entries = Object.entries(phoenicianGlyphs);
  const rows = Math.ceil(entries.length / perRow);
  const width = perRow * (cellSize + spacing);
  const height = rows * effectiveSize + 20;

  draw.clear();
  draw.size(width, height);

  entries.forEach(([name, definition], index) => {
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    const gx = col * (cellSize + spacing) + cellSize / 2;
    const gy = row * effectiveSize + cellSize / 2;
    const glyph = parseGlyphDefinition(definition);
    const group = draw.group().translate(gx, gy);

    renderGlyphNode(glyph, group, {
      targetWidth: cellSize,
      targetHeight: cellSize,
      mode: previewState.mode,
      brush: previewState.brush
    });

    draw.text(name)
      .font({ size: 14, family: "IBM Plex Mono, monospace", anchor: "middle" })
      .center(gx, gy + cellSize + 10);
  });
}

window.GlyphGen = {
  DEFAULT_SIZE,
  parseGlyphDefinition,
  phoenicianGlyphs,
  previewState,
  renderGlyphTable
};

profileInput.addEventListener("input", () => {
  previewState.brush.profile.kind = profileInput.value;
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

segmentAngleInput.addEventListener("input", () => {
  previewState.profiles.segment.angle = Number.parseFloat(segmentAngleInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

segmentLengthInput.addEventListener("input", () => {
  previewState.profiles.segment.length = Number.parseFloat(segmentLengthInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

circleDiameterInput.addEventListener("input", () => {
  previewState.profiles.circle.diameter = Number.parseFloat(circleDiameterInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

rectangleAngleInput.addEventListener("input", () => {
  previewState.profiles.rectangle.angle = Number.parseFloat(rectangleAngleInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

rectangleWidthInput.addEventListener("input", () => {
  previewState.profiles.rectangle.width = Number.parseFloat(rectangleWidthInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

rectangleHeightInput.addEventListener("input", () => {
  previewState.profiles.rectangle.height = Number.parseFloat(rectangleHeightInput.value);
  syncControls();
  applyActiveProfile();
  renderGlyphTable();
});

applyActiveProfile();
syncControls();
renderGlyphTable();
