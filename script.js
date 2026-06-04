import {
  DEFAULT_SIZE,
  parseGlyphDefinition,
  phoenicianGlyphs,
  renderGlyphNode
} from "./glyph-core.mjs";

const draw = SVG().addTo("#canvas").size(600, 600);
const angleInput = document.querySelector("#brush-angle");
const angleValue = document.querySelector("#brush-angle-value");
const thicknessInput = document.querySelector("#brush-thickness");
const thicknessValue = document.querySelector("#brush-thickness-value");
const previewState = {
  mode: "brush",
  brush: {
    angle: 30,
    thickness: 8,
    color: "#18212b"
  }
};

function formatControlValue(value) {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function syncControls() {
  angleInput.value = String(previewState.brush.angle);
  angleValue.textContent = `${formatControlValue(previewState.brush.angle)}°`;
  thicknessInput.value = String(previewState.brush.thickness);
  thicknessValue.textContent = formatControlValue(previewState.brush.thickness);
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

angleInput.addEventListener("input", () => {
  previewState.brush.angle = Number.parseFloat(angleInput.value);
  syncControls();
  renderGlyphTable();
});

thicknessInput.addEventListener("input", () => {
  previewState.brush.thickness = Number.parseFloat(thicknessInput.value);
  syncControls();
  renderGlyphTable();
});

syncControls();
renderGlyphTable();
