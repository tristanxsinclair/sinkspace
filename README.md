# Sink Space

Sink Space is an independent software studio based in Perth, Western Australia. It builds focused systems for learning, work and everyday life.

Canonical site: https://sinkspace.com.au/

## Current products

- [Eblocki](https://www.eblocki.space) — turns academic work into an honest verdict, visible gap and next correction.
- [WorkProof](https://workproof.tristan01sinclair.chatgpt.site) — captures workplace experience and turns it into grounded evidence of capability. Currently in pilot development.

## Production structure

Sink Space is intentionally lightweight. The production site has no runtime framework or external dependency.

- `dist/index.html` — production homepage and metadata
- `dist/styles.css` — responsive visual system
- `dist/app.js` — current-year footer behaviour
- `dist/mark.svg` — browser icon
- `dist/404.html` — static not-found page
- `dist/robots.txt` — crawler policy
- `dist/sitemap.xml` — canonical sitemap
- `dist/release.json` — small deployment verification artifact
- `.github/workflows/static.yml` — GitHub Pages deployment workflow
- `.openai/hosting.json` — previous ChatGPT Sites hosting configuration retained for reference

GitHub Pages must publish `./dist`, not the repository root.

## Run locally

```bash
python3 -m http.server 8000 -d dist
```

Then open `http://localhost:8000/`.

## Production verification

A release is considered served correctly when:

1. `https://sinkspace.com.au/` returns the current homepage.
2. `https://sinkspace.com.au/release.json` returns the current release marker.
3. Styles and the SVG mark load without 404s.
4. The GitHub Pages Actions deployment for the same commit is successful.
5. HTTPS is valid and `www.sinkspace.com.au` resolves consistently with the canonical domain.

## Status

Eblocki is live. WorkProof is in pilot development. Sink Space is the studio layer that houses both products.

Built by Tristan Sinclair in Perth, Western Australia.
