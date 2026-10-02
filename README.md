# Ironvale

A real-time strategy game for the browser in the spirit of Warcraft II. Mine
gold, chop lumber, build a town and an army, and destroy the computer
opponent's base before it destroys yours.

It is plain JavaScript and HTML5 Canvas with no dependencies or build step. All
art and sound are generated in code, so the repository contains no image or
audio files.

## Play

```sh
npm start          # serves the game at http://localhost:8080
```

Or build a single self-contained file you can open straight from disk:

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
| Arrow keys, screen edges, mouse wheel | Scroll the map |
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
  renderer.js, sprites.js  Canvas 2D drawing; all art is procedural
  controller.js, ui.js   input, selection, command card and side panel
  audio.js               synthesized sound effects (Web Audio)
  main.js                game loop, screens and session handling
scripts/                 dev server and single-file build
test/                    node:test suites (pathfinding, rules, AI soak tests)
```

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
- A WebGL or three.js renderer, if a 3D look is wanted (the simulation doesn't
  depend on how it is drawn)
