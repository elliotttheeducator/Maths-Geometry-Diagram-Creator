# Maths Geometry Diagram Creator

A diagram tool for maths worksheets and tests: triangles, rectangles and
parallelograms, regular polygons, circles/sectors/arcs, prisms, parallel-line
diagrams, and freeform composite outlines. Every quoted angle and length is measured
off the actual drawing, so a diagram can never be labelled with something its geometry
doesn't support — type 80° twice and you get a real isosceles triangle, not one that
merely says 80.

Export is PNG or SVG, cropped to the drawing with no dead space, ready to paste into
Word.

## Running it

- **Hosted:** GitHub Pages, from `main` (Settings → Pages → Source → GitHub Actions).
- **Locally:** any static server from the repo root, e.g. `python3 -m http.server`.
  There is no build step — `index.html` loads the ES modules in `js/` directly.
- **As a single file:** `node build/bundle.mjs` writes `dist/artifact.html`, a
  self-contained copy with no external references (for publishing as a Claude
  Artifact). It also regenerates `AI-INSTRUCTIONS.md` and `skill/`.

## Diagrams from written specs

A whole diagram can be written in one line, which is how an AI assistant can produce
worksheets for this tool without reading or rebuilding it:

```
triangle a=80 b=80 ab=6 fill=cream
---
prism base=poly n=6 side=3 depth=10 hidden
---
path 0,0 10,0 10,4 6,4 6,7 0,7 close fill=amber
```

Paste that into **Spec…** in the toolbar, or open the page with the spec URL-encoded
after `#spec=`. One diagram loads onto the canvas ready to edit; several (`---`
separated) render as a grid with Copy / Save / Save all.

[`AI-INSTRUCTIONS.md`](AI-INSTRUCTIONS.md) is the one-page reference to paste into a
Claude Project, and [`skill/geometry-diagrams/`](skill/geometry-diagrams) is the same
thing packaged as a Claude Skill. Both are generated from `js/aiCard.js` — edit that,
not them.

## Layout

| Path | What's in it |
|---|---|
| `js/geometry.js` | vector/geometry helpers; `PX_PER_UNIT` sets the scale |
| `js/shapes/` | one module per shape, each owning its own solver, fields and rendering |
| `js/spec.js` | the written spec format, both directions |
| `js/sidebar.js` | renders whatever fields a shape declares in `getFields()` |
| `js/export.js` | PNG/SVG export, cropping, and the batch sheet |
| `js/palette.js` | the textbook palette, with three tints per colour for 3D shading |
| `build/bundle.mjs` | single-file bundler + instruction-file generator |

Shapes talk to the app through a small interface (`mount`, `getFields`, `setField`,
`render`, `destroy`, and optionally `snapPoints`/`outline`), so adding a shape means
adding one module and one toolbar button.
