import phoenicianGlyphs from "./phoenician-glyphs.json" with { type: "json" };
import futhorcGlyphs from "./futhorc-glyphs.json" with { type: "json" };

export const glyphSets = Object.freeze({
  phoenician: phoenicianGlyphs,
  futhorc: futhorcGlyphs
});

export const DEFAULT_GLYPH_SET = "futhorc";

export function getGlyphDefinitions(setName = DEFAULT_GLYPH_SET) {
  const glyphs = glyphSets[setName];

  if (!glyphs) {
    throw new Error(`Unknown glyph set: ${setName}`);
  }

  return glyphs;
}

export const defaultGlyphs = getGlyphDefinitions();

export {
  futhorcGlyphs,
  phoenicianGlyphs
};
