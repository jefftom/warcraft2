# Ironvale

A real-time strategy game for the browser in the spirit of Warcraft II. Mine
gold, chop lumber, build a town and an army, and destroy the computer
opponent's base before it destroys yours.

The battlefield is drawn in 3D with [three.js](https://threejs.org): stylised
low-poly models, real-time shadows, animated water and swaying forests. A
classic top-down 2D view is one click away on the title screen, and is used
automatically when WebGL isn't available. All art and sound are generated in
code, so the repository contains no image or audio files.

## Play

```sh
npm install        # three.js, plus esbuild for the single-file build
npm start          # serves the game at http://localhost:8080
```

Or build a single self-contained file (three.js included) you can open straight
from disk:

```sh
npm run build      # writes dist/ironvale.html
```

### Controls

| Input | Action |
| --- | --- |
| Click / drag | Select a unit, or box-select a group |
| Right-click | Smart command: move, attack, mine, chop or deliver goods |
| Shift + click | Add or remove a unit from the selection |
| Double-click / Ctrl + click | Select all units of that type on screen |
| Ctrl + 1–9, then 1–9 | Save and recall control groups (press twice to jump to the group) |
| Arrow keys, screen edges | Scroll the map |
| Mouse wheel, + / − | Zoom (3D view); the wheel scrolls in the classic view |
| Minimap | Click to look, right-click to send the selection |
| Space | Center on the selection |
| Esc | Cancel the current order, or open the menu |

Every button on the command card shows its hotkey. With a Town Hall or
Barracks selected, right-clicking the map sets a rally point.

## What's in this first version

- **Economy:** Peasants mine gold (they enter the mine, like the original) and
  chop trees, which run out and become stumps. Food comes from Town Halls and
  Farms.
- **Buildings:** Town Hall, Farm, Barracks, Lumber Mill, Blacksmith and Guard
  Tower, with a tech tree: Archers and Towers need a Lumber Mill, and Knights
  need a Blacksmith.
- **Units:** Peasant, Footman, Archer and Knight. Damage uses armor and piercing
  damage, as Warcraft II does.
- **Upgrades:** two levels each of weapon and armor research at the Blacksmith.
- **Computer opponent** (Easy, Normal, Hard): it gathers resources, follows a build
  order, expands when its mine runs low, defends its base and attacks in waves
  that grow over time.
- **Maps:** a new map every game. Maps are generated from a seed and are
  point-symmetric, so both sides start on equal terms.
- Fog of war, minimap, control groups, rally points, training queues,
  construction, attack-move and hold position.

## Project layout

```
index.html, styles.css   page shell and console styling
src/
  config.js              all unit, building, research and balance data
  game.js                simulation core (no DOM; runs headless in tests)
  unit.js, building.js   unit and building behaviour
  pathfinding.js         grid A* toward rectangles within a given range
  map.js                 seeded, symmetric map generator
  ai.js                  computer opponent
  fog.js                 fog of war
  renderer.js, sprites.js  classic 2D view; all art is procedural
  three/                 3D view (three.js): camera rig, terrain, models,
                         effects, fog-of-war shader; see src/three/README.md
  visibility.js          what the player may see, shared by both views
  controller.js, ui.js   input, selection, command card and side panel
  audio.js               synthesized sound effects (Web Audio)
  main.js                game loop, screens and session handling
scripts/                 dev server and single-file build (esbuild)
tools/                   3D showcase scene and headless screenshot tool
test/                    node:test suites (pathfinding, rules, AI soak tests)
```

Both views implement the same small view interface (picking, box selection,
screen-to-world conversion, camera moves), so input handling doesn't care
which one is active.

The simulation runs at a fixed 60 ticks per second and is deterministic for a
given seed. It never touches the DOM, which is what lets the tests run full
AI-versus-AI games in a couple of seconds.

## Tests

```sh
npm test
```

## Ideas for later

- A second faction with its own units and art
- Ships, oil and sea maps
- Spellcasters (healing, slow, summons)
- Campaign missions and a map editor
- Saving and loading
- Multiplayer (the deterministic lockstep simulation is a good foundation)
- Camera rotation and a free-look mode in the 3D view
