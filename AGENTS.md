# Kingdoms of Plastic: notes for coding agents

A Warcraft II–style real-time strategy game that runs in the browser: plain
JavaScript ES modules, three.js for the 3D view, no framework. Player-facing
docs are in `README.md`; the 3D renderer's architecture and art rules are in
`src/three/README.md`. Read both before changing rendering code.

Work happens on `claude/funny-meitner-73avif`, which is currently the repo's
default and only branch.

## Commands

```sh
npm install          # three.js and esbuild
npm start            # http://localhost:8080
npm test             # node:test suites in test/ (headless AI-vs-AI games included)
npm run build        # dist/ironvale.html, one self-contained file (dist/ is gitignored)
node tools/check3d.mjs                       # scripted 3D interaction checks; exits 1 on failure
node tools/shot.mjs --page game --view 3d    # headless screenshots into .shots/
node tools/shot.mjs --focus brickarmies --style brick
```

The two tools in `tools/` need Playwright with Chromium
(`npm install --no-save playwright && npx playwright install chromium`).
Headless Chromium renders in software, so it is slow: the brick scenes take
seconds per frame. Judge performance by the draw-call and triangle counts the
tools print, not by frame rate.

Before committing: `npm test` always; `node tools/check3d.mjs` after changes to
input, views or the controller; screenshots after visual changes.

## Ground rules

- The simulation (`src/game.js`, `unit.js`, `building.js`, `ai.js`, `map.js`,
  `pathfinding.js`, `fog.js`) is deterministic, runs at a fixed 60 ticks per
  second and never touches the DOM. Keep it that way: tests and future
  lockstep multiplayer depend on it.
- All balance data lives in `src/config.js`.
- The classic 2D renderer (`src/renderer.js`) and the 3D renderer
  (`src/three/index.js`) implement the same view interface; `src/controller.js`
  talks only to `this.view`. A new view must implement the whole interface.
- Some internal names still say "ironvale" (the dist file name, the
  `ironvale.settings` localStorage key, the `window.__ironvale` debug handle).
  Renaming the localStorage key resets players' settings.
- If the art is ever published, avoid the LEGO name and logo, and don't copy
  the minifigure's shape. The toy style should stay generic.

## Art styles

| Style | Where | Status |
| --- | --- | --- |
| Standard 3D | `src/three/` | Default in the game |
| Classic 2D | `src/renderer.js`, `src/sprites.js` | Title-screen option and WebGL fallback |
| Brick (toy plastic) | `src/three/brick/` | Prototype: `Renderer3D(canvas, game, stage, { style: 'brick', assetBase })`, reachable only through `tools/showcase.html?style=brick&focus=brickarmies`, not yet in the game's View menu |

In the brick style the player fields humans and the enemy fields orcs
(`factionOf` in `src/three/brick/figures.js`). Footmen use glTF models from
Blender; other units still use the code-built figures in `brick/units.js`.
Only the farm has a brick building model so far (`brick/buildings.js`).

### Figure models (`src/three/brick/figures.js`)

- `MODELS` maps `'faction:unitType'` to a `.glb` under `assets/models/`. A
  missing or failing file falls back to the built-in figure.
- Each model is one skinned mesh with vertex colours. Pure magenta
  (`#ff00ff`) vertices are swapped for the owner's team colour per team.
- Clips must be named `Idle`, `Walk` and `Attack`. Attack is played once per
  swing and stretched to 0.42 s; Walk speed follows the unit's speed.

## Blender pipeline (`tools/blender/`)

Scripts run headless, either with Blender 5.x
(`blender -b -P tools/blender/figures.py -- --out assets/models --renders .shots/blender`)
or with the `bpy==5.0.1` pip package, which needs Python 3.11
(`python tools/blender/figures.py --out assets/models --renders .shots/blender`).

- `figures.py` models, rigs, animates and exports `human_footman.glb` and
  `orc_grunt.glb`, and can render preview images. Models are built from
  primitives; each part is rigidly bound to one bone through a vertex group.
- `reference_sheets.py` renders front, left, back, right and three-quarter
  views of each figure in its rest pose into `assets/source/reference/`, as
  input for image-to-3D tools.
- Conventions: Blender is Z-up and figures face −Y; the glTF export turns that
  into Y-up facing +Z, which the game expects. `import bpy` must come before
  `bmesh` and `mathutils`. Budget is about 7–9k triangles and under 500 KB
  per figure.

## Next steps

1. **Tripo test with the orc grunt.** Generate a model in Tripo from
   `assets/source/reference/orc_grunt_*.png` (multi-view, textured) and keep
   the raw download as `assets/source/tripo/orc_grunt.glb`. Then write a Blender
   import script that sets scale and facing (about 1.1 tall, feet at z=0,
   facing −Y), decimates to about 8k triangles, binds the mesh to the skeleton
   from `figures.build_rig(ORC_RIG)` with automatic weights, reuses the
   actions from `figures.build_actions(arm, heavy=True)` and exports to
   `assets/models/`. Textured models need a team-colour mask: the current
   swap in `figures.js` only reads vertex colours. Compare the result with the
   current grunt in `tools/showcase.html?style=brick&focus=brickarmies`.
2. Remaining human/orc pairs: peasant/peon, archer/axe thrower, knight/wolf
   rider.
3. Brick models for the other buildings, and orc-style buildings for the
   enemy.
4. Add Brick to the title screen's View option (`index.html`, `src/main.js`).
5. Ideas the owner has raised: a kid's-bedroom battlefield, a map editor with
   triggers and custom modes like Cannon Run, and a Steam release (desktop
   wrapper, controller support, achievements).

## Gotchas

- three r186 removed `PCFSoftShadowMap`; use `PCFShadowMap`.
- Strong bloom washes out the glossy plastic. The tuned values are in
  `src/three/post.js` and the brick branch of `Renderer3D`.
- Peasants inside a mine, depot or construction site have `u.hidden` set.
  Views must not draw them, and tests that click units must account for it.
