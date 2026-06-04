# glyph-gen

This repo is now set up as a plain static site:

- `index.html` holds the page markup
- `styles.css` holds the page styles
- `script.js` holds the glyph rendering logic
- `index-jsfiddle-yrkmvpas-11.html` is the original JSFiddle export kept for reference

## Local preview

From the repo root, run:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## GitHub Pages

This repo includes [`/.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which deploys the site automatically when you push to `main`.

To finish enabling Pages in GitHub:

1. Push this repo to GitHub.
2. In the repo settings, open `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Push to `main` again if needed.

After that, GitHub will publish the live preview URL for the repo.
