# 3D renderer

`index.js` (`Renderer3D`) draws the game with three.js and implements the same
view interface as the classic 2D renderer (`src/renderer.js`): `resize`,
`render(frame)`, `syncTerrain(minimap)`, `pick`, `unitsInRect`, `screenToWorld`,
`isOnScreen`, `centerOn`, `panBy`, `wheel`, `zoomBy`, `footprint`, `dispose`.
The game simulation knows nothing about rendering.

## Coordinates

- 1 world unit = 1 map tile. +Y is up.
- World `x` = game px / `TILE`; world `z` = game py / `TILE`.
- A unit at game position `(u.x, u.y)` stands at `(u.x / TILE, heightAt(..), u.y / TILE)`.
- A building with top-left tile `(b.x, b.y)` and `b.size` covers world
  `x ∈ [b.x, b.x + size]`, `z ∈ [b.y, b.y + size]`; its centre is `(b.x + size/2, b.y + size/2)`.
- The camera looks north (toward −z) from the south, pitched ~56° down. The sun
  comes from the upper left and behind (`sunOffset = (-20, 34, -13)`), so shadows fall
  toward the lower right of the screen.

## Layers

Each layer receives a `LayerContext` (see the typedef in `index.js`):
`game, scene, renderer, rig, fog, palette, particles, heightAt, visible, layers`.

| File | Class | Called each frame | Also exports |
| --- | --- | --- | --- |
| `terrain.js` | `Terrain` | `update(clock)` | `heightAt(x, z)` |
| `foliage.js` | `FoliageLayer` | `update(frame, clock)`, `onTileChanged(x, y, tile)` | |
| `buildings.js` | `BuildingLayer` | `sync(frame, clock)`, `metrics(b) → { height }` | `createBuildingModel(type, owner, palette)` |
| `units.js` | `UnitLayer` | `sync(frame, clock)`, `metrics(u) → { height, radius }` | `createUnitModel(type, owner, palette)` |
| `effects.js` | `EffectsLayer` | `sync(frame, clock)` | |

`frame` is `{ time, dt, selection: Set<id>, hover, markers, alerts, dragRect, placement }`
(see `Controller.frame`). `clock` is real seconds since the renderer started; it
keeps running while the game is paused, so use it for ambient motion (water,
smoke, swaying trees, flags) and the game state for gameplay motion.

Every layer must:

- show only what `ctx.visible(entity)` allows, and remove models for entities
  that are gone or hidden (`u.hidden` is set while a peasant is inside a mine,
  a depot or a construction site);
- patch every lit material with `ctx.fog.patch(material, { key })` (the shared
  `palette` materials already are) so fog of war darkens it;
- cast and receive shadows where it makes sense (`castShadow`, `receiveShadow`);
- clean up GPU resources in `dispose()`.

## Shared helpers

- `geo.js`: low-poly model kit. `box`, `cyl`, `cone`, `sphere`, `ico`, `dodeca`,
  `torus`, `prism`, `gable`, `pyramid` return transformed, vertex-coloured,
  non-indexed geometries; `merge([...])` joins them into one. Draw merged models with
  `palette.matte`, `palette.metal` or `palette.glow` (all flat-shaded, fog-patched,
  `vertexColors`).
- `palette.js`: `SWATCH` (shared material colours) and `teamColors(owner)`
  → `{ main, dark, light }`. Team colour belongs on roofs, banners, tabards,
  shields, plumes and horse caparisons.
- `particles.js`: `ctx.particles.glow` / `spark` (additive) and `smoke`
  (alpha-blended) with `emit({ x, y, z, vx, vy, vz, life, size, size1, color: [r,g,b,a], color1, gravity, drag })`.
  Sizes are world units. Particles hide themselves under fog.
- `fog.js`: `fog.patch(material, { key, beginVertex, uniforms })` can also inject
  vertex animation (for example, wind sway uses `uTime`, which is the renderer clock).

## Art direction

Stylised low poly with chunky, readable silhouettes, seen from a high RTS camera
in warm late-afternoon light. Think classic 90s fantasy strategy redone as
clean faceted models: no textures on models, two or three tones per material for
depth (lighter tops, darker undersides and trims), bold team colour.

- **Scale.** Units are about 0.8–0.9 units tall (knights about 1.2), with
  oversized heads, hands, weapons and shields so they read from far away. A
  building fills its footprint to within ~0.1 of the edges. Rough heights: farm
  1.3, barracks/lumber mill/blacksmith 1.8–2.2, town hall 3.2 including the spire, tower 3.0.
- **Materials.** Use `SWATCH` so everything matches: stone walls, timber
  framing, thatch or slate roofs, iron and steel. Team colour on roofs and
  cloth. Warm glowing windows (`palette.glow`) give life.
- **Motion.** Everything alive moves a little: walk cycles, idle breathing,
  weapon swings, chopping, smoke from chimneys, swaying trees, flags in the wind,
  glinting water.
- **Budget.** The whole scene should stay at a few hundred draw calls with 150
  units on screen. Merge static parts; share geometries per (type, team); use
  `InstancedMesh` for anything numerous (trees, rocks, grass, rubble).

## Checking your work

`npm start`, then open `tools/showcase.html?focus=<preset>`, or take
screenshots headlessly:

```sh
node tools/shot.mjs --focus units,fight --out .shots/units
node tools/shot.mjs --focus all
node tools/shot.mjs --page game --view 3d
```

Presets: `overview, units, unitsclose, fight, buildings, townhall, workshops,
construction, foliage, effects, fog`. For a custom scene, put a page under
`.shots/` (gitignored) and shoot it with `--url /.shots/<dir>/<page>.html`. The tool prints console errors and renderer stats (draw calls,
triangles). Headless Chromium renders with SwiftShader (software), so it is
slow; judge performance by draw calls and triangles, not frame rate.
