# glyph-gen

This repo is now set up as a plain static site:

- `index.html` holds the page markup
- `styles.css` holds the page styles
- `script.js` is the browser entrypoint that renders the demo table
- `glyph-core.mjs` holds the glyph grammar, parser, geometry, and layout pipeline
- `glyph-generate.mjs` learns serializable set grammars and generates synthetic glyph sets from them
- `glyph-render.mjs` holds the SVG rendering and brush/stroke output logic
- `glyph-definitions.mjs` loads named glyph fixture sets from JSON files such as `phoenician-glyphs.json`, `futhorc-glyphs.json`, and `roman-glyphs.json`
- `index-jsfiddle-yrkmvpas-11.html` is the original JSFiddle export kept for reference

## Local preview

From the repo root, run:

```bash
python3 -m http.server 8000
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). The page lets you switch among the registered Phoenician, Futhorc, and Roman sets from the control bar.

## Glyph Grammar

Glyph definitions are small strings that describe how primitives are combined into a glyph.

### Primitive tokens

- `T` creates a triangle
- `R` creates a square cell
- `C` creates a four-segment circle/arc primitive
- `S` creates an eight-ray starburst

Each primitive can take an optional bitmask and an optional legacy rotation suffix:

- `T5`
- `R6`
- `C3`
- `S170`
- `Tr270`
- `T5r180`

The bitmask controls which primitive edges or rays are visible.

- For `T`, the mask is read across 3 edges.
- For `R` and `C`, the mask is read across 4 edges.
- For `S`, the mask is read across 8 rays.
- A `1` bit keeps an edge visible.
- A `0` bit hides it.

Examples:

- `R1` keeps only one square edge visible.
- `C3` keeps two adjacent quarter arcs visible.
- `S17` keeps two starburst rays visible.

The `rNNN` suffix is a primitive-local rotation in degrees.

### Composition operators

- adjacency places primitives in the same row: `T R`
- `|` starts a new row: `T|R`
- `*` overlays shapes in the same cell: `C*S17`
- `[` `]` groups an expression: `[C*S17]|S1`

Examples:

- `T3r270|R2` puts a rotated triangle above a square-cell edge
- `T5r270*S17` overlays a triangle and a starburst
- `[T T]*R` overlays a square cell on top of a two-column group

### Suffix modifiers

Any primitive or grouped expression can be followed by zero or more suffix modifiers.

- `t(x,y)` translates after layout
- `s(x)` scales uniformly
- `s(x,y)` scales non-uniformly
- `c(k)` curves straight line segments into quadratic curves
- `h(lobe[,taper])` warps visible arc segments into a heart-like curve
- `b()` switches a starburst from circular radius mode to rectangular cell-bounds mode

Examples:

- `S17 t(4,-2)`
- `R s(1.2,0.8)`
- `T c(0.25)`
- `C3 h(0.35,0.65)`
- `S19 b()`
- `[C*S17] t(2,0) s(0.9)`

Modifier order is left to right.

### Layout semantics

The grid system uses full primitive cell anchors for layout.

- A square edge token like `R2` still lays out as a full square cell, even if only one edge is visible.
- Hidden edges affect rendering, but not the canonical anchor box used to place the cell in the grid.
- Translation via `t(...)` is applied after grid placement, so you can nudge geometry without changing which cell it belongs to.
- Overlay via `*` is often the cleanest way to combine a structural shape with a long stroke.
- `b()` is useful when starburst rays should reach the rectangle corners of the cell rather than points on the inscribed circle.
- `h()` is useful for shapes like `pe`, where a circular arc should read more like the side of a heart than a strict half-circle.

This matters for glyphs like `giml`, `kap`, `lamed`, `mem`, and `nun`, where a visible edge may only be one line but still needs to align as part of a full square cell.

## Examples

Some definitions from the current Phoenician set in `phoenician-glyphs.json`:

- `aleph: T5r270*S17`
- `giml: T3r270|R2`
- `tet: C*S170`
- `pe: C3 h(0.35,0.65)`
- `qop: [C*S17]|S1`
- `sade: S19 b() S130 b()`
- `mem: T5r180 T5r180 R8 | R0 R0 R8 | R0 R0 R8`

To add another set, create a sibling JSON file and register it in `glyph-definitions.mjs` under a new set name. The preview selector is populated from those registered set names.

## Development Notes

The current pipeline is split across `glyph-core.mjs` and `glyph-render.mjs`:

1. tokenize
2. parse into an AST
3. compile primitives/composites into geometry
4. measure and place geometry in the grid
5. fit geometry into the preview cell
6. render SVG paths and lines

There is a small Node test suite for parser and geometry behavior:

```bash
node --test tests/glyph-core.test.mjs tests/glyph-score.test.mjs tests/glyph-generate.test.mjs
```

## Set Grammar Generation

The library now supports a grammar-first generation flow:

```js
import { induceSetGrammar, generateGlyphSet } from "./glyph-generate.mjs";

const { grammar } = induceSetGrammar("phoenician");
const generated = generateGlyphSet({
  grammar,
  seed: "demo"
});
```

- `induceSetGrammar(source, options?)` accepts a built-in set name or a custom glyph map and returns a serializable probabilistic set grammar plus induction diagnostics
- `generateGlyphSet({ grammar, seed, ... })` samples a full sibling alphabet from that grammar and returns generated definitions with per-slot diagnostics

## GitHub Pages

This repo includes [`/.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which deploys the site automatically when you push to `main`.

To finish enabling Pages in GitHub:

1. Push this repo to GitHub.
2. In the repo settings, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main` again if needed.

After that, GitHub will publish the live preview URL for the repo.
