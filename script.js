import {
  DEFAULT_SIZE,
  parseGlyphDefinition,
  phoenicianGlyphs,
  renderGlyphNode
} from "./glyph-core.mjs";

const draw = SVG().addTo("#canvas").size(600, 600);

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
      targetHeight: cellSize
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
  renderGlyphTable
};

renderGlyphTable();
