# Sink Space

Sink Space is an independent software studio based in Perth, Western Australia. It builds focused systems for learning, work, and everyday life.

Live site: [sinkspace.tristan01sinclair.chatgpt.site](https://sinkspace.tristan01sinclair.chatgpt.site)

## Products

- [Eblocki](https://www.eblocki.space) — turns academic work into a verdict, visible gap, and next correction.
- [WorkProof](https://workproof.tristan01sinclair.chatgpt.site) — captures workplace experience and turns it into verified evidence of capability.

## Project structure

The site is a lightweight static build with no runtime dependencies:

- `dist/index.html` — page structure and content
- `dist/styles.css` — responsive visual system
- `dist/app.js` — current-year footer behaviour
- `dist/mark.svg` — Sink Space browser icon
- `.openai/hosting.json` — ChatGPT Sites hosting configuration

## Run locally

Serve the repository root with any static web server and open `/dist/`.

For example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/dist/`.

## Status

Sink Space is live. Eblocki is live and WorkProof is in pilot development.

Built by Tristan Sinclair.
