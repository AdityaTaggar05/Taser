# WeldPoint / Taser

A fullscreen, two-player online temporal pincer puzzle built with Phaser 3, TypeScript and Vite. The URL requires sign-in, then opens a fullscreen title screen with animated chamber artwork, Play co-op, a field guide, settings and account completion progress. Sign in with two different accounts and press Play co-op on two tabs, browsers or devices: the first connection becomes P1 (forward time), the second P2 (reverse time). Each browser renders only its player's board, boxes and objectives. Guest play is disabled. Wallet sign-in and two development accounts are available; invitations and parties come later.

## Run and connect

Requires Node.js 22.13+ (Node 24 recommended; server authentication uses built-in SQLite).

```sh
npm install
npm run dev
```

Open the printed URL in **two separate tabs/browsers**, sign in with different accounts, then choose **Play co-op** in each. Browsing the home menu does not connect to the multiplayer room or occupy a slot. A `#play` link requires sign-in before opening the game and can restore a refreshable session. The default port is 5173. If that port is occupied, run `npm run dev -- --port 5174` and use that same port in both browsers. Do not use the browser's Duplicate Tab command: it can copy the session token and attempt to resume the same player rather than join as the second player.

For another device on the same network, use the **server computer's LAN address** with the printed port, rather than `localhost`. Allow the port through the host firewall if necessary. The development server listens on all interfaces.

Only two players can occupy the shared room. Additional connections see a room-full message and retry periodically. A solo connection waits for a partner; neither player can advance until both are connected.

### Sign-in and development accounts

The sign-in screen accepts **Sign-In with Ethereum** through an injected browser wallet. The server issues an origin-bound, five-minute, single-use SIWE challenge and verifies the signature. Signing does not send a transaction. An account is created on the first successful signature; subsequent sign-ins restore its progress. The wallet address identifies the account; changing the connected wallet does not silently change an authenticated game account. Sign out to use another wallet.

In `npm run dev`, the following test accounts are available. Choose **Use Atlas** or **Use Nova** to fill the form, then **Sign in**:

| Username | Password |
| --- | --- |
| `atlas` | `Atlas@WeldPoint26!` |
| `nova` | `Nova@WeldPoint26!` |

Sign-ins are isolated per tab, so Atlas and Nova can play together in the same browser. Refresh preserves each tab's sign-in and seat. Open a fresh tab rather than duplicating an existing one: Duplicate Tab copies its context and seat. One account cannot occupy both seats. The home screen's profile button shows the account, saved progress and Sign out.

Sessions last 24 hours and use HttpOnly, SameSite cookies; browser storage contains only a public tab context and room resume token. Game sockets require a short-lived, single-use authenticated ticket. Signing out or session expiry closes live game access. SQLite stores salted password hashes, hashed session tokens and verified completions in `.data/accounts.sqlite` (ignored by Git). Persist that directory on your server; do not publicly serve it. Existing browser-only guest completion markers are not imported as verified wins.

Demo login is **disabled by default in `npm start` and `npm run preview`**. For a private production-style playtest, explicitly set `DEMO_AUTH=true`; set `DEMO_AUTH=false` to disable demos even in development. These are shared test identities, so participants using the same demo account cannot play against each other.

Set `APP_ORIGIN` to the exact public origin behind an HTTPS proxy. Ethereum EOA signatures verify without an RPC. Contract wallet verification requires `ETHEREUM_RPC_URL` (Ethereum mainnet) or `SEPOLIA_RPC_URL` (Sepolia). Other contract-wallet networks and WalletConnect are not implemented. Browser wallets usually require HTTPS or localhost; use the demo accounts for a plain HTTP LAN playtest. ENS names/avatars are deferred; wallet profiles currently display a shortened address.

See `.env.example` for optional server variables. Vite reads those locally; for `npm start`, export them in the process environment (or use Node's environment-file support).

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
- **Backspace / Z:** undo for both players. **R:** reset for both. **1–5:** select a chamber for both. Either connected player can use these shared controls during this playtest.
- **H:** local guide. **F:** browser fullscreen. Theme, sound, hints and timeline review are local to each browser.
- Clicking recorded turns reviews only your own history. Return to live to choose moves. A new shared turn, undo, reset or chamber change returns the view to live.
- Hints show only your role's reference input. Winning completions are verified by the server and saved to both accounts.

### Home, settings, disconnections and refresh

Use the Home button in the game toolbar to return to the title screen. This immediately frees your slot, clears queued inputs and resets the current chamber for the remaining player. A replacement can join immediately. Sound and environment preferences persist in browser storage. Account progress persists on the server. The guide and settings use keyboard-accessible modal dialogs; title animation respects reduced-motion preferences.


A disconnect pauses play and clears queued inputs, preventing stale moves from firing when a partner returns. The server reserves the disconnected role for **45 seconds**. Refreshing the original tab restores that role and the current timeline using a per-tab session token. If the reservation expires, the room resets to chamber 1 before a replacement joins. Dead connections are detected by WebSocket heartbeats, so a silent network loss may take additional time to be noticed.

Closing both tabs reserves both seats until the grace period expires. Reopening the original tabs can resume; fresh browsers must wait for those reservations to expire. Session storage must be available to recover a role across a full reload. These are temporary playtest semantics; a later party layer can provide explicit leave/rejoin and campaign ownership.

## Architecture

- `src/core/types.ts`: serializable level and simulation contracts.
- `src/core/engine.ts`: deterministic simulation with no Phaser, DOM or networking dependencies. The multiplayer server uses this same engine for validation, turns, replay and undo.
- `src/core/level.ts` and `src/data/levels.json`: validation/import boundary and five authored puzzles. Coordinates remain 1-indexed, bottom-left Cartesian; box indices are stable identities.
- `server/CoopRoom.ts`: transport-independent room, assigned roles, pending moves, revisions, shared controls and reconnect reservations. A future party service can own one instance per party.
- `server/socket.ts`: authenticated one-use tickets, account-bound roles, bounded WebSocket messages, same-origin browser connections, heartbeat and reconnect cleanup.
- `server/auth/AuthService.ts`: SIWE challenge verification, development login, persistent SQLite accounts, revocable sessions and verified progress.
- `src/auth/AuthClient.ts` and `src/ui/SignInScreen.ts`: required sign-in, tab-isolated session restoration and injected wallet flow.
- `server/index.ts`: production HTTP/static and WebSocket service.
- `vite.config.ts`: attaches the same multiplayer service to development and preview servers.
- `src/network/protocol.ts`: typed commands and player-specific state messages. Revisions reject commands sent before a turn, reset, undo or chamber change.
- `src/network/CoopClient.ts`: same-origin WS/WSS connection, per-tab refresh recovery and automatic reconnect. Commands are never replayed automatically after reconnect.
- `src/network/RemoteView.ts`: adapts only the assigned player's server history to the renderer. The server does not send partner positions, partner box history or partner queued directions.
- `src/render/BoardView.ts`: single-player board, coordinates, laser visualization, shove animation and replay trajectories. The renderer also remains reusable for future editor previews.
- `src/render/environment.ts`: swappable palettes and sprite manifests.
- `src/ui/Hud.ts`: online status, assigned role, controls, timeline review, guide and return-home action.
- `src/ui/HomeScreen.ts` and `src/ui/home.css`: fullscreen authenticated entry, profile/sign-out, native guide/settings dialogs, preferences and account progress.
- `src/render/TitleBackdrop.ts`: decorative animated title chamber using the swappable environment textures, independent of multiplayer state.
- `src/input/TurnBuffer.ts`: reusable validated local input buffer retained for headless tests and future editor tools.

This is one shared two-seat playtest room with mandatory account authentication. The server enforces accounts, assigned roles and rules; a future lobby/party layer will handle private groups and invitations. No blockchain transactions are required to play. Arkiv integration and ENS enrichment remain separate future work.

## Replace artwork / add environments

Add square PNG/WebP assets to `public/assets/`. Register an `EnvironmentPack` in `src/render/environment.ts` with URLs for any of `floor`, `wall`, `box`, `mirror`, `p1`, `p2` or `ice`. Unspecified roles use the generated vector textures (96×96 source). All registered packs preload at startup. Set the optional `environment` id in level data to choose its default pack. Presentation changes do not change simulation rules.

## Custom chamber creator

Sign in and choose **Level creator** on the home screen, or open `#create`. The fullscreen workspace starts with a blank floor and movable starter objects. The template picker copies any of the five campaign chambers, including its reference solution; editing the copy never changes the campaign.

### Design and record a solution

- Set the name, description, dimensions (2–20 per side), even timeline (2–32 turns), box count (1–6 pairs), environment and mirror-box setting.
- Choose a tool and click a tile. Drag to paint walls, floor, ice, switches or erase overlays. Coordinates remain 1-indexed with `(1,1)` at the bottom left. Grid zoom supports a fitted overview and larger scrollable tiles.
- Box identity **A–F** links one P1 start, one P2 start and one weld target. Select the identity before placing each. Spawns, exits and paired box positions are moved with their own tools; the eraser removes optional overlays. Changing the box-pair count adds/removes complete identities.
- **Author** shows both layouts and weld targets only inside the editor. **P1 view** and **P2 view** hide the partner's objects/objectives and weld targets. Gameplay never shows author overlays.
- The laser tool places an emitter using the chosen cardinal direction. The receiver opens P1's exit; pressure switches open their assigned exit. The mirror setting currently applies to every box, following the engine's existing level-wide rule.
- **Undo/Redo**, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` restore design changes. Arrow keys move keyboard focus between grid cells; Enter/Space places the selected tool. `Ctrl/Cmd+S` saves, committing the active text field first.
- **Start playtest** validates the layout and records a fresh run. The creator controls both input rows, with WASD/Space for P1 and arrows/Enter for P2; one valid selection per operator commits a turn. Invalid inputs never consume turns. Cancel replaces a pending choice; Undo turn removes both recorded inputs. The selected board shows one role at a time.
- Win on the final turn, then choose **Use winning solution**. **Replay solution** tests an imported/template/captured route using the same engine. Changing any design field clears the recorded witness. Undo can restore the exact prior level and its witness.

### Save, publish and play

**Save draft** persists an account-owned draft even before it is solvable. Unsaved changes also have account-and-tab-scoped browser recovery; save to the server for access on another device. **Import/Export** exchanges one level object as JSON, including recorded solutions. Imports are capped at 64 KB and use the shared bounded schema; unknown fields are removed. There is no arbitrary script or remote-asset execution from level files.

**Publish** first saves the current draft, then the server independently replays both submitted move lists. A valid publication requires a complete winning run, including legal inputs, midpoint weld, hazard checks and both open exits on the final turn. This verifies the submitted witness, not every possible solution. No client-provided success flag is trusted.

**My levels / Community** lists up to 100 owned drafts or the latest 100 published chambers. Only owners can load/edit a draft. Publishing returns a shareable `#play/<level-id>` link: open it with two different signed-in accounts to play in the existing shared co-op room. Custom-game hints are disabled, and clients receive neither the submitted witness nor partner objectives, initial boxes or weld coordinates. Custom wins do not award campaign completion markers yet.

Saving a revision leaves the previous verified publication playable. Republishing replaces it only after another successful verification. A running room keeps the snapshot it started with. Concurrent saves from stale tabs return a conflict instead of overwriting newer work; export local edits, reload from My levels and reapply them. Accounts can store up to 100 drafts. Deletion/unpublishing, private parties, per-level ratings and Arkiv storage are future work.

Custom levels use the **same single two-seat room** as campaign play. A custom link cannot interrupt another active chamber: both players should return Home first. An ordinary Play co-op connection can join the chamber already waiting in that room. A refresh resumes an existing account's current seat, including after a shared chamber change. If a reconnect reservation expires, the room resets to campaign chamber 1, as before.

The SQLite database in `.data/` now contains accounts, sessions, campaign progress, drafts and published snapshots. Preserve it when hosting; production and Vite development/preview attach the same authenticated level API and game service.

### Creator architecture

- `src/core/levelValidation.ts`: bounded draft shape and imported-field normalization; `src/core/level.ts` adds playable-layout/reference-route requirements.
- `src/editor/EditorModel.ts`: draft history, placement, resizing, paired identities and solution recording, without DOM dependencies.
- `src/editor/solution.ts`: deterministic witness verification shared by the browser and publishing service.
- `src/editor/EditorScreen.ts` and `editor.css`: fullscreen workspace, author/role perspectives, import/export, recovery, library and publishing UI.
- `src/editor/LevelClient.ts`: authenticated draft/publish API adapter.
- `server/levels/LevelStore.ts`: revision-checked SQLite drafts and separately verified published snapshots.
- `server/levels/LevelApi.ts` and `server/api.ts`: account ownership, same-origin mutations, bounded JSON and application routing.
- `server/CoopRoom.ts`: immutable custom-room snapshot and per-role public level projections.

## Rules and original design

The authored solutions require stepping into a tile a replay box vacates during that same turn. Replay checks against the new box positions, including when waiting; ice replay checks final occupancy rather than every intermediate tile. Exits are traversable floor with switch-controlled win eligibility, allowing the documented Level 2 spawns. The midpoint switch is checked at the weld; the original data has no separate gate coordinates.

Original design authority: the local `temporal_pincer_mvp_specification.md`. The specification stays ignored and is not included in commits. Later user requirements supersede its original split-screen layout: online single-board views, hidden partner objectives/ghosts and weld markers, and rejected blocked selections.

## Verification

```sh
npm test
npm run build
```

The tests include creator recording across all five templates, draft undo/redo and solution invalidation, bounded imports, verified publication, revision conflicts, ownership, snapshot persistence, custom-room privacy and reconnects, plus all five winning solutions, move rejection, ice, lasers and undo, plus authoritative two-player playthroughs, role enforcement, queue privacy, stale-command rejection, shared controls, disconnect/resume, expired reservations intentional home exits with immediate seat reuse, and authenticated WebSocket clients. Authentication tests cover development login and disabled-production behavior, tab isolation, origin checks, signed wallet verification, nonce replay, expiry, one-use game tickets, revocation and persistent verified progress. The socket integration test requires permission to bind a local loopback port.
