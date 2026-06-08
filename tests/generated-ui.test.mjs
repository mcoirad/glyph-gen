import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("generated panel includes a text preview frame below the main generated canvas", () => {
  const generatedCanvasIndex = indexHtml.indexOf('id="generated-canvas"');
  const textPreviewPanelIndex = indexHtml.indexOf('class="text-preview-panel"');
  const textPreviewCanvasIndex = indexHtml.indexOf('id="generated-text-preview"');

  assert(generatedCanvasIndex >= 0);
  assert(textPreviewPanelIndex > generatedCanvasIndex);
  assert(textPreviewCanvasIndex > textPreviewPanelIndex);
});

test("generated panel exposes the expected writing mode selector options", () => {
  assert(indexHtml.includes('id="generated-preview-mode"'));
  assert(indexHtml.includes('<option value="ltr">Left to Right</option>'));
  assert(indexHtml.includes('<option value="rtl">Right to Left</option>'));
  assert(indexHtml.includes('<option value="ttb">Top to Bottom</option>'));
  assert(indexHtml.includes('<option value="boustrophedon">Boustrophedon</option>'));
});
