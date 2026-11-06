# WeldPoint / Taser

A fullscreen, two-player online temporal pincer puzzle built with Phaser 3, TypeScript and Vite. Open the same server URL on two browsers or devices: the first connection becomes P1 (forward time), the second P2 (reverse time). Each browser renders only its player's board, boxes and objectives. No home page, login, invitations or party system is required for this playtest.

## Run and connect

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open the printed URL in **two separate tabs/browsers**. The default port is 5173. If that port is occupied, run `npm run dev -- --port 5174` and use that same port in both browsers. Do not use the browser's Duplicate Tab command: it can copy the session token and attempt to resume the same player rather than join as the second player.

For another device on the same network, use the **server computer's LAN address** with the printed port, rather than `localhost`. Allow the port through the host firewall if necessary. The development server listens on all interfaces.

Only two players can occupy the shared room. Additional connections see a room-full message and retry periodically. A solo connection waits for a partner; neither player can advance until both are connected.

### Production / remote playtest hosting

```sh
npm run build
npm start
```

The Node server serves `dist/` and the WebSocket endpoint together. It listens on `PORT` (default 5173). `npm run preview` also attaches the multiplayer service to Vite's preview server, on port 4173.

For players on different networks, run this Node service on a reachable host. A static-only upload of `dist/` is insufficient. A reverse proxy must forward WebSocket upgrades for `/co-op` and preserve the public Host/Origin; HTTPS automatically uses WSS in the browser. Run **one server instance** for this prototype: room state is in memory and is not shared across processes. Restarting the server starts a fresh session.

## Play

- Either role can use **WASD or arrow keys** to move, **Space or Enter** to wait, or the on-screen controls.
- The server assigns roles; a browser can submit moves only for its own assigned role.
- Both queued inputs immediately commit one simultaneous turn. Change or cancel your queued move before the other player commits. You see whether your partner is ready, but not their chosen direction.
- Wall bumps, out-of-bounds moves and blocked Phase 1 shoves are rejected without consuming a turn or clearing a valid queued move. Unavailable directions are disabled. Laser exposure and locked-history collisions remain committed gameplay failures.
- **Turns 1–4:** coordinate box positions with your partner. A shove moves the box while you stay put. Spatial weld markers and partner box ghosts are hidden.
- **Turn 4:** corresponding box identities must match at the level's required unmarked weld coordinates. The corner chamber also requires its midpoint switch.
- **Turns 5–8:** boxes replay your partner's history in reverse. Dotted trajectories show the next positions of your boxes. Reach both open exits exactly on turn 8.
- **Backspace / Z:** undo for both players. **R:** reset for both. **1–9, 0:** select a chamber for both (1–10). Either connected player can use these shared controls during this playtest.
- **H:** local guide. **F:** browser fullscreen. Theme, sound, hints and timeline review are local to each browser.
- Clicking recorded turns reviews only your own history. Return to live to choose moves. A new shared turn, undo, reset or chamber change returns the view to live.
- Hints show only your role's reference input. Completion markers persist locally when storage is available.

### Disconnections and refresh

A disconnect pauses play and clears queued inputs, preventing stale moves from firing when a partner returns. The server reserves the disconnected role for **45 seconds**. Refreshing the original tab restores that role and the current timeline using a per-tab session token. If the reservation expires, the room resets to chamber 1 before a replacement joins. Dead connections are detected by WebSocket heartbeats, so a silent network loss may take additional time to be noticed.

Closing both tabs reserves both seats until the grace period expires. Reopening the original tabs can resume; fresh browsers must wait for those reservations to expire. Session storage must be available to recover a role across a full reload. These are temporary playtest semantics; a later party layer can provide explicit leave/rejoin and campaign ownership.

## Architecture

- `src/core/types.ts`: serializable level and simulation contracts.
- `src/core/engine.ts`: deterministic simulation with no Phaser, DOM or networking dependencies. The multiplayer server uses this same engine for validation, turns, replay and undo.
- `src/core/level.ts` and `src/data/levels.json`: validation/import boundary and thirteen authored puzzles. Coordinates remain 1-indexed, bottom-left Cartesian; box indices are stable identities.
- `server/CoopRoom.ts`: transport-independent room, assigned roles, pending moves, revisions, shared controls and reconnect reservations. A future party service can own one instance per party.
- `server/socket.ts`: bounded WebSocket messages, role binding, same-origin browser connections, heartbeat and reconnect cleanup.
- `server/index.ts`: production HTTP/static and WebSocket service.
- `vite.config.ts`: attaches the same multiplayer service to development and preview servers.
- `src/network/protocol.ts`: typed commands and player-specific state messages. Revisions reject commands sent before a turn, reset, undo or chamber change.
- `src/network/CoopClient.ts`: same-origin WS/WSS connection, per-tab refresh recovery and automatic reconnect. Commands are never replayed automatically after reconnect.
- `src/network/RemoteView.ts`: adapts only the assigned player's server history to the renderer. The server does not send partner positions, partner box history or partner queued directions.
- `src/render/BoardView.ts`: single-player board, coordinates, laser visualization, shove animation and replay trajectories. The renderer also remains reusable for future editor previews.
- `src/render/environment.ts`: swappable palettes and sprite manifests.
- `src/ui/Hud.ts`: online status, assigned role, controls, timeline review and guide.
- `src/input/TurnBuffer.ts`: reusable validated local input buffer retained for headless tests and future editor tools.

This is a public two-seat playtest room with no account authentication or persistent sessions. The server enforces assigned roles and rules; a future lobby/party layer will handle private groups and invitations.

## Replace artwork / add environments

Add square PNG/WebP assets to `public/assets/`. Register an `EnvironmentPack` in `src/render/environment.ts` with URLs for any of `floor`, `wall`, `box`, `mirror`, `p1`, `p2` or `ice`. Unspecified roles use the generated vector textures (96×96 source). All registered packs preload at startup. Set the optional `environment` id in level data to choose its default pack. Presentation changes do not change simulation rules.

The level maker is deferred until requested. Its level contract, import validator and renderer-free engine are available to reuse.

## Rules and original design

The authored solutions require stepping into a tile a replay box vacates during that same turn. Replay checks against the new box positions, including when waiting; ice replay checks final occupancy rather than every intermediate tile. Exits are traversable floor with switch-controlled win eligibility, allowing the documented Level 2 spawns. The midpoint switch is checked at the weld; the original data has no separate gate coordinates.

Original design authority: the local `temporal_pincer_mvp_specification.md`. The specification stays ignored and is not included in commits. Later user requirements supersede its original split-screen layout: online single-board views, hidden partner objectives/ghosts and weld markers, and rejected blocked selections.

## Verification

```sh
npm test
npm run build
```

The tests include all five winning solutions, move rejection, ice, lasers and undo, plus authoritative two-player playthroughs, role enforcement, queue privacy, stale-command rejection, shared controls, disconnect/resume, expired reservations and two actual WebSocket clients. The socket integration test requires permission to bind a local loopback port.
