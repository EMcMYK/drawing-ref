# Drawing Reference

A free, browser-based app that helps people learn to draw and helps artists find reference: a 3D still-life you can arrange and light, and (next) a library of free, properly credited reference images.

v1 is **Reference mode**: no accounts, everything runs in the browser.

## What works now

**3D still life**
- Six drawing-class shapes: cube, sphere, cylinder, cone, pyramid, egg (up to 12 at once).
- Click to select, drag to move; drop a shape on another to stack it. Rotate (Q / E), tip over, resize, change height.
- Shade each shape white, light, mid or dark gray for value studies.
- One spotlight: drag the yellow ball, or use the sliders and presets. A fixed, dim fill keeps shadows from going black.
- Eye level, high and low views; one fixed, normal lens.
- Random set-up and three starter scenes.
- **Save PNG** at 2× resolution, without the light handle or selection outline.
- The scene is kept in the browser, so a reload brings it back.

**References**
- Eight categories of free reference images (animals, plants, sculpture, objects and vases, aircraft and machines, architecture, weapons and armor, musical instruments).
- Search within a category, filter to "no credit needed", Random, and a large viewer with credit, license and a link to the source.
- Images are hotlinked from the source; only CC0, public domain, CC BY and CC BY-SA are included.

## Reference library index

`scripts/library/build.mjs` pulls images from each source's API, filters them (license, documents and flat art, size, aspect ratio) and writes `public/library/<category>.json`. Sources and queries per category are in `scripts/library/categories.mjs`.

It runs on GitHub Actions ("Build reference library"): a small sample on pull requests that touch the builder, and the full build when run by hand, which commits the result to that branch. Sources needing no key for now: The Met, Art Institute of Chicago, Cleveland Museum of Art, iNaturalist, Wikimedia Commons, NASA, Museums Victoria.

## Develop

```sh
npm ci
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build into dist/
```

## Deploy

Static site, built for Cloudflare Pages (free tier):

- Build command: `npm run build`
- Output directory: `dist`

## Code map

- `src/still-life/layout.js`: pure table logic (keep on table, no overlaps, stacking). Unit-tested.
- `src/still-life/model.js`: scene data, presets, starter scenes, random scenes, validation of saved data.
- `src/still-life/shapes.js`: the six geometries and the gray shades.
- `src/still-life/still-life.js`: three.js scene, lights, dragging, PNG export.
- `src/still-life/panel.js`: the control panel.
- `src/still-life/persist.js`: browser storage and downloads.
