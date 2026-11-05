# WeldPoint

A playable local two-player temporal pincer puzzle, built with Phaser 3, TypeScript and Vite. The game fills the browser window; press **F** or the fullscreen button for browser fullscreen. On a 16:9 display the three synchronized grids sit side by side. Narrow portrait windows put the combined view below the two operators.

## Run

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open the printed local URL (normally http://localhost:5173). `npm run build` creates a static production build in `dist/`; `npm run preview` serves it. There is no backend or networked multiplayer.

## Play

- **P1:** WASD to move; Space to wait.
- **P2:** arrow keys to move; Enter to wait.
- Both queued inputs immediately commit a turn. Either operator can revise a queued move until the other queues theirs. Hold-to-repeat is disabled. Wall bumps, out-of-bounds moves and blocked Phase 1 shoves are rejected before queueing, preserving existing valid selections. Disabled move buttons show unavailable directions; keyboard attempts display the reason. Use Wait to deliberately spend a turn.
- **Turns 1–4:** coordinate box positions with your partner. Shoving moves the box while the player stays put. Individual boards show only their operator's boxes, switches and exit; P1's laser receiver is also hidden from P2. Partner box previews and spatial weld markers are hidden.
- **Turn 4:** corresponding box identities must match at the level's required weld coordinates. These coordinates are not marked on any board. The corner chamber also requires its midpoint switch. The combined view still shows both operators and their boxes and objectives.
- **Turns 5–8:** boxes replay the other operator's history in reverse. Dotted trajectories preview the next box positions. Reach both open exits exactly on turn 8.
- **Backspace / Z:** undo, including after a paradox or victory. **R:** reset. **1–5:** select chamber. **H:** guide. **F:** fullscreen.
- Click recorded timeline turns to inspect history, then **Return to live**. Inspection does not modify the live timeline.
- On-screen move buttons support pointer/touch input. **Hint** shows the paired reference inputs for the next turn and warns when the route differs from the reference.

All five authored chambers, switches, identity-based double welds, laser refraction, ice slides and reverse catapults are implemented. Completion markers persist locally when browser storage is available.

## Architecture and future editor boundary

- `src/core/types.ts`: shared serializable level and snapshot contracts.
- `src/core/engine.ts`: deterministic simulation with no Phaser or DOM dependencies. Each successful input pair adds a full independent snapshot to `stateStack`. Undo removes the last snapshot, so rewriting a turn also rewrites its future replay.
- `src/core/level.ts`: validation and `parseLevel(json)` import boundary. A future web editor can share this validator, export `LevelConfig` JSON and playtest using `new GameEngine(config)`.
- `src/data/levels.json`: the five level payloads copied from the source specification. Coordinates remain 1-indexed, bottom-left Cartesian; box array indices are permanent box identities.
- `src/input/TurnBuffer.ts`: simultaneous turn queue, independent of the renderer and input device.
- `src/render/BoardView.ts`: grid layout, coordinate-to-screen conversion, per-operator objective visibility, laser visualization, shove animation and replay trajectories.
- `src/render/environment.ts`: swappable environment palette and texture manifest. The bundled foundry and orbital packs demonstrate presentation changes without changing puzzle rules.
- `src/ui/Hud.ts`: compact controls, timeline inspection and operator guide.

### Replace artwork or add an environment

Add PNG/WebP assets to `public/assets/`. Add or modify an `EnvironmentPack` in `src/render/environment.ts`, mapping any of `floor`, `wall`, `box`, `mirror`, `p1`, `p2` and `ice` to asset URLs, for example `assets: { p1: '/assets/operator-blue.png', wall: '/assets/lab-wall.png' }`. Unspecified roles retain the generated built-in artwork. Sprites should be square with transparent margins; default source textures are 96×96. Texture loading is in the scene's preload stage.

Set an optional `environment` id in a level's JSON to select its default pack. All registered packs preload on startup. No movement, collision or timeline code needs changes to replace a sprite or environment.

The level maker itself is intentionally deferred until requested. Its shared level contract, import validator and headless playtest engine are ready.

## Turn-resolution clarifications

The source spec's winning solutions require entry into a tile vacated by a box during the same replay turn (for example Level 1, turn 7). Replay resolves against **new box positions**, then checks the player's destination, including remaining stationary. Attempting to enter an occupied locked box triggers `PARADOX_COLLISION`; stepping into a vacated tile is legal. Ice replay checks the final occupied coordinate, as specified, rather than every intermediate tile.

Exits are traversable floor with switch-controlled win eligibility; this allows the documented starts on the other operator's closed exit in Level 2. The spec contains no separate gate coordinates, so the midpoint switch is checked at the weld. Walls, boundaries and blocked Phase 1 shoves reject the input without consuming a turn. Direct engine calls also reject an invalid pair atomically. Laser exposure and locked-history collisions remain committed gameplay failures; validation does not remove these hazards. Mirrors are not lethal themselves; the outgoing beam is. Laser raycasting guards against loops and ignores the Wait direction for emitters.

## Verification

```sh
npm test
npm run build
```

Tests run every authored solution through all eight turns and verify midpoint positions, opposite-history replay, open exits and victory. Additional checks cover stationary and blocked shoves, queue replacement, undo branching, failed welds, locked-box collisions, laser death and shielding, identity mismatch, ice catapult replay, time expiry and JSON validation.

Original design authority: `temporal_pincer_mvp_specification.md`.

Presentation changes requested after the original specification: hide partner objectives and box ghosts on individual boards, and hide spatial weld-point markers on every board. The underlying puzzle rules and combined view remain available.
# Taser
