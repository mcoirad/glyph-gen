import test from "node:test";
import assert from "node:assert/strict";

import {
  createPreviewBrush,
  createPreviewCorpus,
  createPreviewLayoutOptions,
  createPreviewPlacements
} from "../glyph-text-preview.mjs";

test("createPreviewCorpus stays stable for the same generated run seed", () => {
  const input = {
    definitions: {
      a: "R",
      b: "T",
      c: "C"
    },
    seed: "run-1",
    sourceSetName: "roman"
  };

  const first = createPreviewCorpus(input);
  const second = createPreviewCorpus(input);
  const changed = createPreviewCorpus({
    ...input,
    seed: "run-2"
  });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, changed);
});

test("createPreviewBrush quarters size fields and preserves other brush settings", () => {
  const segmentBrush = createPreviewBrush({
    color: "#111111",
    profile: {
      kind: "segment",
      angle: 30,
      length: 8
    }
  });
  const circleBrush = createPreviewBrush({
    color: "#111111",
    profile: {
      kind: "circle",
      diameter: 12,
      taperStart: 0.2,
      taperEnd: 0.4
    }
  });
  const rectangleBrush = createPreviewBrush({
    color: "#111111",
    profile: {
      kind: "rectangle",
      angle: 45,
      width: 16,
      height: 8
    }
  });

  assert.equal(segmentBrush.profile.length, 2);
  assert.equal(segmentBrush.profile.angle, 30);
  assert.equal(segmentBrush.color, "#111111");

  assert.equal(circleBrush.profile.diameter, 3);
  assert.equal(circleBrush.profile.taperStart, 0.2);
  assert.equal(circleBrush.profile.taperEnd, 0.4);

  assert.equal(rectangleBrush.profile.width, 4);
  assert.equal(rectangleBrush.profile.height, 2);
  assert.equal(rectangleBrush.profile.angle, 45);
});

test("createPreviewPlacements produces distinct ordering for writing modes", () => {
  const words = [
    ["a", "b"],
    ["c", "d"],
    ["e", "f"],
    ["g", "h"]
  ];
  const compactLayout = {
    width: 72,
    height: 180,
    inset: 10,
    glyphCellSize: 12,
    glyphGap: 4,
    wordGap: 8,
    lineGap: 10
  };
  const ltr = createPreviewPlacements(words, "ltr", compactLayout);
  const rtl = createPreviewPlacements(words, "rtl", compactLayout);
  const ttb = createPreviewPlacements(words, "ttb", {
    ...compactLayout,
    height: 84
  });
  const boustrophedon = createPreviewPlacements(words, "boustrophedon", compactLayout);

  assert(ltr[0].x < ltr[1].x);
  assert(rtl[0].x > rtl[1].x);
  assert.equal(ttb[0].x, ttb[1].x);
  assert(ttb[0].y < ttb[1].y);
  assert(boustrophedon[2].x > boustrophedon[3].x);
});

test("createPreviewLayoutOptions keeps the preview layout compact and responsive", () => {
  const layout = createPreviewLayoutOptions(560, 280);

  assert(layout.glyphCellSize >= 12 && layout.glyphCellSize <= 22);
  assert(layout.inset >= 12 && layout.inset <= 22);
  assert.equal(layout.width, 560);
  assert.equal(layout.height, 280);
});
