# WeldPoint

A fullscreen temporal pincer puzzle built with Phaser 3, TypeScript and Vite, with mandatory sign-in and two modes. **Co-op** uses private two-person parties with invite links/codes, role assignment, Ready confirmations and host-controlled start. **Solo** pairs your chosen role with a fixed creator solution or a verified winning player run. Before your first valid move, an Other perspective switch lets you study the opposite role’s starting board for as long as you want. Your first valid selection locks the switch and returns you to your own board. Wallet sign-in and two development accounts are available; guest play is disabled.

## Run and connect

Requires Node.js 22.13+ (Node 24 recommended; server authentication uses built-in SQLite).

```sh
npm install
npm run arkiv:setup
# Configure .env.local, fund its printed server signer, and set approved fee budgets.
npm run arkiv:check
npm run arkiv:quote
npm run arkiv:migrate
npm run dev
```

Open the printed URL and sign in. Choose **Play co-op** or **Play solo**, then **Campaign** or **Community**, a chamber, and P1/P2. Browsing the menus does not start a game or occupy a party seat. The default port is 5173; another port can be selected with `npm run dev -- --port 5174`. Use the same server address in both browsers. Open fresh tabs rather than Duplicate Tab, which can copy the authenticated tab context.

For co-op, the first operator hosts a private party and shares its invite link or six-character code. Codes accept either letter case and omit I, O, 0 and 1 to avoid confusion. The invited account takes the opposite role. Both operators choose **Ready**, then the host chooses **Start challenge**. Enter a code from Home → Play co-op. There is no automatic public-room matching. Separate parties and solo attempts run independently. One account can participate in one session at a time.

For solo, choose **Creator solution** or **Player runs** after selecting your role. The server retrieves and decrypts the selected replay, then commits one recorded partner input per valid human move. A replay never adapts, skips a move, or pads its ending with waits. If it finishes before both operators exit, the attempt ends; Undo and Reset remain available.

For another device on the same network, use the **server computer's LAN address** with the printed port, rather than `localhost`. Allow the port through the host firewall if necessary. The development server listens on all interfaces.

Parties currently have two seats and no spectators. Up to 200 independent game sessions can run on one server instance. Invites require sign-in and cannot grant access to a different account’s session or hidden puzzle data.

### Sign-in and development accounts

The sign-in screen accepts **Sign-In with Ethereum** through an injected browser wallet. The server issues an origin-bound, five-minute, single-use SIWE challenge and verifies the signature. Signing does not send a transaction. An account is created on the first successful signature; subsequent sign-ins restore its progress. The wallet address identifies the account; changing the connected wallet does not silently change an authenticated game account. Sign out to use another wallet.

In `npm run dev`, the following test accounts are available. Choose **Use Atlas** or **Use Nova** to fill the form, then **Sign in**:

| Username | Password |
| --- | --- |
| `atlas` | `Atlas@WeldPoint26!` |
| `nova` | `Nova@WeldPoint26!` |

Sign-ins are isolated per tab, so Atlas and Nova can play together in the same browser. Refresh preserves each tab's sign-in and seat. Open a fresh tab rather than duplicating an existing one: Duplicate Tab copies its context and seat. One account cannot occupy both seats or join multiple simultaneous sessions. The home screen's profile button shows the account, saved progress and Sign out.

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

For players on different networks, run this Node service on a reachable host. A static-only upload of `dist/` is insufficient. A reverse proxy must forward WebSocket upgrades for `/co-op` and preserve the public Host/Origin; HTTPS automatically uses WSS in the browser. Run **one server instance** for this prototype: room state is in memory and is not shared across processes. Restarting the server clears parties, invitations and in-progress solo attempts; archived levels, runs and verified completions remain in storage.

## Play

- **Other perspective:** after a solo attempt starts, or the co-op host starts a ready party, use the switch above the board to view the opposite role’s **initial** configuration. There is no countdown or time limit. Switch back and forth freely before your first valid move. Movement buttons and keys always control your assigned role; submitting your first valid move automatically returns to your own view and locks the switch for that attempt, including while that move is only queued. Wait counts. Invalid/stale/disconnected selections do not lock it. Each human’s lock is independent; the other player can keep studying until they choose a move. Cancel and Undo do not unlock it, even after undoing to turn zero. Reset/Try again unlocks both players; refresh and reconnect preserve each lock. The study projection contains only the opposite starting role: no live partner positions, history, weld coordinates or solutions. After the first selection the server omits that projection. Initial data is intentionally shared for study and may already have been retained by the browser.

- Either role can use **WASD or arrow keys** to move, **Space or Enter** to wait, or the on-screen controls.
- Choose P1 or P2 before connecting. The server reserves that exact role and accepts moves only from its assigned account. An occupied or reconnecting role waits rather than assigning the other role.
- In co-op, both queued inputs immediately commit one simultaneous turn. Change or cancel your queued move before the other player commits. You see whether your partner is ready, but not their chosen direction.
- Wall bumps, out-of-bounds moves and blocked Phase 1 shoves are rejected without consuming a turn or clearing a valid queued move. Unavailable directions are disabled. Laser exposure and locked-history collisions remain committed gameplay failures.
- **Turns 1–4:** coordinate box positions with your partner. A shove moves the box while you stay put. Spatial weld markers and partner box ghosts are hidden.
- **Midpoint:** corresponding box identities must match. A level may additionally require unmarked fixed weld coordinates. The corner chamber also requires its midpoint switch.
- **Turns 5–8:** boxes replay your partner's history in reverse. Dotted trajectories show the next positions of your boxes. Reach both open exits simultaneously after the weld, before the timeline expires.
- **Backspace / Z:** undo both timelines. **R:** reset both. Solo rewinds/restarts the same fixed replay. A session pins one published challenge; return Home to select another. A new co-op challenge creates a new party and invitation.
- **H:** local guide. **F:** browser fullscreen. Theme, sound, hints and timeline review are local to each browser.
- Clicking recorded turns reviews only your own history. Return to live to choose moves. A new shared turn, undo, reset or chamber change returns the view to live.
- **Reference route** unlocks only after a server-verified **co-op** win on the exact published revision. It displays both recorded input lists. Ordinary gameplay never receives either solution. Co-op completions are verified by the server and saved to both accounts. Solo wins do not award campaign progress or unlock reference solutions, even when playing against a player run.

### Home, settings, disconnections and refresh

**Try again** on a finished attempt restarts the same challenge and, in solo, the same replay. **Go to party** in co-op returns both players to the existing lobby, preserves their roles and invite code, resets the timeline and clears both Ready confirmations. Either party member can use it after an attempt ends; both must ready up and the host starts again. Solo offers **Back to solo** to select another challenge.

Use Home to deliberately leave a game. A host leaving closes the party for both operators. An invited player leaving returns the host to the lobby, resets the timeline and clears both Ready confirmations; a replacement can use the same invite. Leaving solo ends that attempt. Preferences persist in browser storage; co-op progress persists on the server.

A disconnect pauses co-op and clears queued moves. Refreshing the `#session/<id>` URL resumes the authenticated operator’s role and timeline. The reconnect grace period is **45 seconds**, swept every 10 seconds. An absent host ends the session when the grace period expires. An absent guest is removed and the host returns to the lobby on the same chamber; both operators must ready up again. A lobby disconnect also clears Ready confirmations. Heartbeat detection can add delay before an abrupt network loss is noticed.

### Winning runs and expiration

Every server-verified win automatically queues a run for **each human operator**: both people in co-op, or only the human in solo. The replay-controlled role never creates another player run. Only committed inputs on the final winning timeline are recorded; undo/reset discard superseded inputs. The server independently replays the complete winning witness before archiving it.

Runs bind the exact Arkiv level entity key and role. Choosing P1 lists P2 runs, and vice versa. Published levels are immutable. Runs bind their exact publication identity. The list exposes name, role, turn count, source mode and archive reference, with no moves or puzzle layout. Replay input lists stay on the server during play. Identical inputs from the same account/role/revision are deduplicated within a two-day bucket to avoid paying for repeated identical wins.

Runs are durably queued in private SQLite before publication. A win remains valid when fees/network conditions block the archive write; the UI reports **Arkiv publication pending**. The background worker processes bounded batches through the same exclusive signer, transaction journal and fee caps used by level writes. A known or uncertain transaction is reconciled using its saved hash; it is never automatically resent. Only confirmed runs appear in discovery.

New **published levels, community and campaign**, use `LEVEL_BASE_TTL = ExpirationTime.fromHours(2)`. Each distinct authenticated operator can heart a publication once, adding `HEART_EXTENSION = ExpirationTime.fromHours(1)` to its **real Arkiv expiration block**. The server owner signs `extendEntity` through the existing fee caps and durable journal; duplicate requests and uncertain replies reuse the same operation. Hearts count only after receipt verification and readback. There is no unheart/reheart reset. A new revision has its own hearts and per-level standings. Pending confirmations recover in the background and after restart.

Player runs retain `ExpirationTime.fromDays(2)`; private drafts retain maximum lifetime. Existing chain entities keep their original deadlines. Discovery checks a fresh chain head (cached for up to ten seconds), and starting a challenge/replay reads the current Arkiv entity again. Leaderboard views fetch the actual expiry and fresh head, display the expiration block and an **estimated** countdown, and refresh every 15 seconds. Block production determines actual expiration. An already-running session can finish its pinned snapshot if the publication expires. New starts, leaderboard reads and hearts require an available level. Runs can physically outlive their parent but are unavailable while their level is unavailable.

Choose **Leaderboard** on Home for global co-op standings, or **Leaderboard & hearts** on a published chamber card for that revision’s co-op/solo scores. Global ranking counts distinct campaign and community chambers completed in co-op; repeated wins and revisions do not add progress. Existing campaign completions are included, and progress persists after expiry. Per-level boards keep each operator’s best server-verified turn count, then use earliest achievement time as the tie breaker. Scores remain valid while replay archiving is pending. Both boards paginate and show your rank. See [the design and verification notes](docs/ARKIV_LEADERBOARD.md).

## Architecture

- `src/core/types.ts`: serializable level and simulation contracts.
- `src/core/engine.ts`: deterministic simulation with no Phaser, DOM or networking dependencies. The multiplayer server uses this same engine for validation, turns, replay and undo.
- `src/core/level.ts`: shared validation/import boundary. `server/data/` holds thirteen campaign migration seeds and test fixtures; runtime campaigns are loaded from Arkiv. Coordinates remain 1-indexed, bottom-left Cartesian; box indices are stable identities.
- `server/CoopRoom.ts`: transport-independent room, assigned roles, pending moves, revisions, shared controls and reconnect reservations. Each private party or solo attempt owns its own instance, with server-only fixed replay support and verified input capture.
- `server/game/Sessions.ts`: private invite lobbies, account membership, Ready/start authority, isolated rooms, solo sources and human-run publication.
- `src/network/routes.ts`, `src/ui/PublishedLevels.ts` and `src/ui/PartyLobby.ts`: mode/collection/chamber/role/source navigation and private party UI.
- `server/socket.ts`: authenticated one-use tickets, account-bound roles, bounded WebSocket messages, same-origin browser connections, heartbeat and reconnect cleanup.
- `src/ui/Leaderboards.ts`: global co-op standings, per-publication co-op/solo scores, real expiry reads and idempotent hearts.
- `server/auth/AuthService.ts`: SIWE challenge verification, development login, persistent SQLite accounts, revocable sessions and verified progress.
- `src/auth/AuthClient.ts` and `src/ui/SignInScreen.ts`: required sign-in, tab-isolated session restoration and injected wallet flow.
- `server/index.ts`: production HTTP/static and WebSocket service.
- `vite.config.ts`: attaches the same multiplayer service to development and preview servers.
- `src/network/protocol.ts`: typed commands and player-specific state messages. Revisions reject commands sent before a turn, reset, undo or chamber change.
- `src/network/OtherPerspectiveView.ts`: sanitized opposite-role starting-state adapter, rendered with the same modular board renderer through the pre-move perspective switch.
- `src/network/CoopClient.ts`: same-origin WS/WSS connection, per-tab refresh recovery and automatic reconnect. Commands are never replayed automatically after reconnect.
- `src/network/RemoteView.ts`: adapts only the assigned player's server history to the renderer. The server does not send partner positions, partner box history or partner queued directions.
- `src/render/BoardView.ts`: single-player board, coordinates, laser visualization, shove animation and replay trajectories. The renderer also remains reusable for future editor previews.
- `src/render/environment.ts`: swappable palettes and sprite manifests.
- `src/ui/Hud.ts`: online status, assigned role, controls, timeline review, guide and return-home action.
- `src/ui/HomeScreen.ts` and `src/ui/home.css`: fullscreen authenticated entry, profile/sign-out, native guide/settings dialogs, preferences and account progress.
- `src/render/TitleBackdrop.ts`: decorative animated title chamber using the swappable environment textures, independent of multiplayer state.
- `src/input/TurnBuffer.ts`: reusable validated local input buffer retained for headless tests and future editor tools.

The server enforces account identity, party membership, roles and simulation rules. Gameplay inputs require no wallet signature or transaction. The server pays bounded Rabdi test-token fees for level saves/publications and automatically archived winning runs; ENS enrichment remains future work. Live parties stay on the single application server rather than writing every move on-chain.

## Replace artwork / add environments

Theme packs use versioned manifests and original sprite sheets from a verified Swarm release, selected through the public Arkiv theme pointer. Register packs in `src/assets/sources.ts` and follow [the theme pack contract](docs/THEME_PACKS.md). The active pack loads on demand, with bounded concurrency, progress and a retry action after a 45-second timeout. Party creation proceeds during artwork loading; movement waits for the active pack to be ready. Missing remote artwork remains an error. Set the optional `environment` ID in level data to choose its default pack; presentation never changes simulation rules.

## Custom chamber creator

Sign in and choose **Level creator** on the home screen, or open `#create`. The fullscreen workspace starts with a blank floor and movable starter objects. The template picker lists legacy Arkiv campaign templates. Newly CRE-certified levels are view-only and cannot be copied into the editor. An ordinary account must first complete the exact published revision to unlock its layout and reference solution for remixing. Campaign admins can access templates directly. Editing a copy never changes the campaign.

### Design and record a solution

- Set the name, description, dimensions (2–20 per side), even timeline (2–32 turns), box count (1–6 pairs), environment and mirror-box setting.
- Choose a tool and click a tile. Drag to paint walls, floor, ice, switches or erase overlays. Coordinates remain 1-indexed with `(1,1)` at the bottom left. Grid zoom supports a fitted overview and larger scrollable tiles.
- Box identity **A–F** links one P1 start, one P2 start and, when enabled, one fixed weld target. Toggle Require fixed weld positions to choose flexible matching or fixed positions. Select the identity before placing each. Spawns, exits and paired box positions are moved with their own tools; the eraser removes optional overlays. Changing the box-pair count adds/removes complete identities.
- **Author** shows both layouts and weld targets only inside the editor. **P1 view** and **P2 view** hide the partner's objects/objectives and weld targets. Gameplay never shows author overlays.
- The laser tool places an emitter using the chosen cardinal direction. The receiver opens P1's exit; pressure switches open their assigned exit. The mirror setting currently applies to every box, following the engine's existing level-wide rule.
- **Undo/Redo**, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` restore design changes. Arrow keys move keyboard focus between grid cells; Enter/Space places the selected tool. `Ctrl/Cmd+S` saves, committing the active text field first.
- **Start playtest** validates the layout and records a fresh run. The creator controls both input rows, with WASD/Space for P1 and arrows/Enter for P2; one valid selection per operator commits a turn. Invalid inputs never consume turns. Cancel replaces a pending choice; Undo turn removes both recorded inputs. The selected board shows one role at a time.
- Win after the weld and within the timeline, then choose **Use winning solution**. **Replay solution** tests an imported/template/captured route using the same engine. Changing any design field clears the recorded witness. Undo can restore the exact prior level and its witness.

### Save, publish and play

**Save draft** confirms an encrypted, account-owned revision on Arkiv even before it is solvable. A private SQLite recovery row is saved first; if the network write fails, it appears as Archive pending, and My levels can recover it. A save is not reported as Arkiv-confirmed before receipt verification and encrypted readback succeed. Unsaved changes also have account-and-tab-scoped browser recovery; save to the server for access on another device. **Import/Export** exchanges one level object as JSON, including recorded solutions. Imports are capped at 64 KB and use the shared bounded schema; unknown fields are removed. There is no arbitrary script or remote-asset execution from level files.

**Publish** first saves the current draft and locally replays its winning solution. It then freezes a submission for CRE verification. New community and campaign publications require a matching Sepolia certificate before the final Arkiv publication becomes playable. The editor shows Pending, Approved / archive pending, Published or Rejected. A rejected witness unlocks the draft; transport errors retry the same frozen input. Existing levels stay playable as Legacy · server verified. Simulation certificates are explicitly labeled. See [CRE certification and setup](docs/CRE_CERTIFICATION.md).

**My levels / Community** lists up to 100 owned drafts or the latest 100 published chambers. Only owners can load/edit a draft. After certification and archive confirmation, publishing returns a shareable `#play/<level-id>` link: open it to choose Solo or Co-op and then a role. Co-op creates a private party; invite your partner using the party’s separate invite link/code. The home screen’s **Published levels** section lists Community publications and the Campaign catalog, with metadata only. Browse or refresh without occupying a seat; select a chamber to open its P1/P2 picker. Only confirmed publications are listed; drafts and failed/pending writes stay private. A chosen-role URL retains that choice across refresh. Share the original level link so your partner can choose their own role. Clients never receive the submitted witness or weld coordinates. The opposite role’s initial configuration is available separately until your first valid move; ordinary gameplay updates contain only the assigned role’s objectives and boxes. After a co-op completion of the published revision, Reference route unlocks for that account. Custom wins do not award campaign completion markers yet.

Draft saves use internal counters to reject stale-tab changes. A pending or approved submission cannot be edited. Published identities remain permanently read-only, with no copy/remix/export action; correcting a rejected solution creates a new verification request. Unsaved private drafts can still be imported/exported. Accounts can store up to 100 drafts. Deletion/unpublishing and per-level ratings are future work.

Custom chambers support the same private co-op and fixed-replay solo modes as campaign chambers. A link cannot replace another party’s challenge. Solo creator solutions come from the encrypted publication; player-run options require an exact matching revision and opposite role.

SQLite in `.data/` holds private accounts, sessions, exact-revision completion records, recovery drafts and the local Arkiv projection. Arkiv is the source of confirmed level revisions. Startup loads and validates the trusted encrypted catalog; it does not silently use bundled campaign levels when Arkiv fails. Preserve both databases and the encryption key when hosting; production and Vite development/preview attach the same authenticated level API and game service.

### Creator architecture

- `src/core/levelValidation.ts`: bounded draft shape and imported-field normalization; `src/core/level.ts` adds playable-layout/reference-route requirements.
- `src/editor/EditorModel.ts`: draft history, placement, resizing, paired identities and solution recording, without DOM dependencies.
- `src/editor/solution.ts`: deterministic witness verification shared by the browser and publishing service.
- `src/editor/EditorScreen.ts` and `editor.css`: fullscreen workspace, author/role perspectives, import/export, recovery, library and publishing UI.
- `src/editor/LevelClient.ts`: authenticated draft/publish API adapter.
- `server/levels/LevelStore.ts`: revision-checked recovery drafts, confirmed Arkiv publications, dynamic campaign slots and revision-specific solution access.
- `server/levels/LevelApi.ts` and `server/api.ts`: account ownership, same-origin mutations, bounded JSON and application routing.
- `server/CoopRoom.ts`: immutable custom-room snapshot and per-role public level projections.


## Shared artwork and Swarm theme packs

Approved original sprite sheets are under `public/themes/modern-gray/`. The shared manifest drives Phaser gameplay/title artwork and DOM editor/interface sprites. See [theme-pack guidelines](docs/THEME_PACKS.md) for the semantic contract and adding a pack.

The selectable **Diwali** pack is under `public/themes/diwali/`: complete kurta animations, matching avatars and exits decorated with lights. P2 wears navy with a green helmet and no chest identity bars. Both packs have separate verified Swarm releases and Arkiv pointers. Select Diwali in home Settings or with the gameplay environment control. Publication tools accept `-- --theme diwali`; add future packs through `src/assets/sources.ts` without changing gameplay or screens. [Diwali publication evidence](docs/themes/diwali-release.json).

Use `npm run assets:public:check`, `npm run assets:upload:public` and `npm run assets:verify:public` for subsidised gateway uploads. New uploads default to the booth-recommended `https://bzz.limo`; a resumed journal preserves the service that accepted its original uploads. PNG collections stay under 8 MB. Only the original public assets and release metadata are uploaded; every byte is checked on readback before deployment changes. Owned-Bee upload commands remain available as a backup.

The release index and all 29 PNGs are now verified on Swarm, including through `bzz.limo`. The bootstrap reads the pinned Arkiv theme entity, checks the release and manifest hashes, and resolves every sprite from its declared Swarm collection. It fails visibly if publication/metadata reads fail. `npm run arkiv:theme:quote` estimates a release-pointer write; `npm run arkiv:theme:publish` uses the existing signer, shared durable journal and configured fee budgets. Stop the running server before invoking these commands because one process holds the signer. See [live evidence and remaining submission details](arkiv/swarm.md).

## Arkiv storage and campaign publishing

The integration pins **@arkiv-network/sdk 1.0.1** and **arkiv-encryption 1.1.1**, on **Rabdi (7794095)**. `npm run arkiv:setup` creates independent signing and AES-256-GCM encryption keys in ignored `.env.local` with mode 0600. It preserves existing keys and prints only the public server signer. Obtain a free [access key](https://hub.arkiv.network/access-keys) and [faucet tGLM](https://hub.arkiv.network/faucet). The wallet used to obtain an access key and the generated server signer are different identities; fund the printed signer address. `npm run arkiv:check` reads its balance and sends no transaction.

Set positive `ARKIV_MAX_TX_FEE_GLM` and `ARKIV_DAILY_FEE_BUDGET_GLM` in `.env.local` only after reviewing `npm run arkiv:quote`. Zero disables writes. Fees are capped using explicit latest nonce, network gasPrice, and the greater of 1,000,000 gas or twice the unsigned estimate; the cap must fit half the latest block gas limit. Daily budgets conservatively reserve the full cap of each admitted transaction rather than assuming refunds. The signer must be dedicated to this one server; do not use it in another process, wallet or host. A host lock coordinates instances. Quoting is unsigned and never broadcasts.

Stop the game server before `npm run arkiv:migrate`. This explicit command uploads the thirteen campaign seeds and existing locally saved drafts/publications, then verifies receipts and encrypted readback. Startup never pays migration fees implicitly. The encrypted archive can reconstruct the level catalog on a fresh local projection using the same signer, namespace and encryption key. Account identities and completion history remain in the private account database and require its backup. Network resets are detected through the recorded genesis block; they require explicit recovery, rather than an automatic reseed.

Each draft/community/campaign revision and winning run is an immutable readonly entity in `weldpoint_levels_v1`. Indexed public columns are namespace, opaque level ID, revision and category. The media type and ciphertext are public too. The full layout, author account/name and both reference solutions are encrypted together **before** SDK encoding. An authenticated envelope also binds its routing fields, namespace and chain. New CRE submissions use a salted witness commitment; the salt and moves remain private. Legacy publications contain no public solution digest. Reads require the configured creator and readonly policy, authenticate the envelope, validate the bounded level schema and replay published witnesses. Untrusted public entities with copied schema tags cannot enter the campaign. The server signer owns these entities; authorship and draft permissions are enforced through authenticated application accounts, rather than claiming each user wallet is the on-chain creator.

Arkiv metadata, transaction timings, signer identity, ciphertext lengths and copies of encrypted data remain public. Keep the encryption key independently backed up; losing it loses level access. Keys, credentialed RPC URLs and raw provider diagnostics never enter browser bundles or API errors. SQLite/journal files are private server storage and include plaintext recovery data; do not publicly serve `.data/`. A player can still solve a puzzle, inspect their own visible board, or share a solution after unlocking it. Encryption cannot make previously public solutions secret: the thirteen campaign seeds were present in source history and remain legacy migration/test fixtures. New authored levels gain the encrypted storage boundary.

**Publish to community** is available to every signed-in author after a verified winning witness. **Publish to campaign** appears only for the Atlas development account while demo authentication is enabled, or for a signed-in wallet listed in `CAMPAIGN_PUBLISHER_WALLETS`. The same restriction is enforced on the server before writer entry. It appends a certified level to the campaign; the selected destination is frozen at submission and the resulting publication cannot be edited or promoted to another collection. Campaign navigation and next-chamber actions use the dynamic catalog. Games already running keep their original revision; an empty room takes the updated campaign. Share links to campaign publications load the campaign slot and award campaign progress.

A verified co-op win records the exact Arkiv entity key for both participating accounts; solo wins do not grant this unlock. The authenticated solution endpoint checks that record before reading/decrypting and returning the two input lists. Numeric completion flags from older releases do not grant access. Published identities are immutable, and each solution unlock remains bound to its exact entity key. Drafts remain visible only to their owner. Campaign admin access is an explicit editorial privilege; regular template access unlocks after completion.

`server/arkiv/ArkivArchive.ts` keeps a durable, synchronous SQLite write journal in `.data/arkiv.sqlite`. It saves the frozen encrypted intent and captures/authenticates signed bytes and hash **before** forwarding. After successful canonical receipt confirmation it saves the key/deadline, then verifies readback before reporting success. A lost send reply, failed receipt lookup or failed readback never initiates another send. Restart/retry reconciles the original hash; unresolved or reverted transactions block new signing. Do not delete the journal to bypass this state. The implementation performs no automatic transaction retries.

Private drafts use `ExpirationTime.max()` (7,884,000 blocks, nominally about 182 days). New campaign and community publications start with two hours; each distinct operator’s heart extends the real entity deadline by one hour. Runs retain two days. Arkiv caps remaining lifetime at its maximum; excessive extensions fail before broadcast. Expired/deleted entities become unavailable through current-state reads and expired entities cannot be revived. Long-term campaign hosting requires hearts or an operator renewal policy; an automatic renewal scheduler is outside this feature. Losing encryption keys, a network reset or expiry cannot be repaired by silently switching to public plaintext.

## Rules and original design

The authored solutions require stepping into a tile a replay box vacates during that same turn. Replay checks against the new box positions, including when waiting; ice replay checks final occupancy rather than every intermediate tile. Exits are traversable floor with switch-controlled win eligibility, allowing the documented Level 2 spawns. The midpoint switch is checked at the weld; the original data has no separate gate coordinates.

Original design authority: the local `temporal_pincer_mvp_specification.md`. The specification stays ignored and is not included in commits. Later user requirements supersede its original split-screen layout: online single-board views, hidden partner objectives/ghosts and weld markers, and rejected blocked selections.

## Verification

```sh
npm test
npm run build
```

Source formatting uses the project-local Prettier configuration. Run
`npm run format` to format the codebase or `npm run format:check` to check it.
TypeScript, scripts, styles, embedded HTML, configuration and Solidity are covered;
generated assets, dependency locks, private files and installed skills are excluded.

The tests additionally cover full-payload encryption, fresh IVs, wrong-key/tamper/routing rejection, trusted creator/readonly checks, lost send replies, failed readback after receipt confirmation, admin publishing denial, Arkiv catalog recovery, exact-revision solution unlocks and dynamic campaigns. HTTP/WebSocket fixtures use an explicit in-memory test archive; these tests do not certify live Rabdi writes. The tests include creator recording across all thirteen templates, draft undo/redo and solution invalidation, bounded imports, verified publication, revision conflicts, ownership, snapshot persistence, custom-room privacy and reconnects, plus all thirteen winning solutions, move rejection, ice, lasers and undo, plus authenticated private party creation/invitations, host-only start, Ready enforcement, isolated solo sessions, fixed replay endings/undo, opposite-role run discovery, exact-revision rejection, automatic human-run publication, pending-write recovery and co-op-only completion unlocks. Authentication tests cover development login and disabled-production behavior, tab isolation, origin checks, signed wallet verification, nonce replay, expiry, one-use game tickets, revocation and persistent verified progress. The socket integration test requires permission to bind a local loopback port.


## CRE certification

See [the implementation, trust boundaries and local setup guide](docs/CRE_CERTIFICATION.md). New publications remain pending when CRE is unconfigured. `npm run cre:build` compiles the shared verifier to WASM; CLI login, a Sepolia registry and a real certificate transaction are separate configuration steps. No deployment or network verification is implied by the build.

For automatic publication using the local CLI, run `npm run cre:local-mode` and
restart the server. A submitted winning solution stays pending until the server's
CRE CLI execution succeeds and returns the matching submission commitment. The
server records a durable local execution receipt, then publishes through the
existing encrypted Arkiv writer. Published cards say **CRE SIMULATION VERIFIED**.
This mode needs CLI login, Bun and the installed workflow dependencies, but no
Sepolia registry or funded CRE signer. CLI failures stay pending for retry; a
receipt is a trusted-server attestation and is never labeled DON verification.

For the verified receiver-free CRE rehearsal, see
[the official TypeScript scaffold](cre-project/level-verification/README.md).
`npm run cre:rehearsal` serves a protected read-only campaign snapshot for the real
CLI simulator. This checks HTTP retrieval, commitments and game replay without
deploying a receiver, certifying a level or publishing to Arkiv.

### Gameplay transaction explorer

While playing, a move-pair explorer sits beside the timeline (below it on narrow screens). Each committed turn forms a 2×1 P1/P2 grid with direction arrows or WAIT, archive status and a transaction link. Click a pair to review that turn. It queries the Arkiv database through an authenticated server endpoint immediately after moves and every three seconds; pending/failed writes are labelled, and query failures are shown as stale. Undo/reset remove superseded pairs from the active sequence. Queued moves and future replay inputs stay hidden. Player-run lists, challenge browsing and the creator retain the minimizable activity panel. Every completed P1/P2 turn queues one encrypted move-pair entity without waiting for chain confirmation. Existing signer journaling and fee caps still apply. See [activity behavior, Arkiv setup changes and validation](docs/block-explorer.md).

### Arkiv fee accounting

The approved per-transaction and UTC daily limits remain enforced. Pending or uncertain writes reserve their full maximum gas fee. Authenticated canonical receipts settle that reservation to the actual fee, including reverted transactions; unused gas no longer consumes the daily allowance. Older journal entries are settled from receipts on demand, retaining the full reservation when evidence is unavailable. The journal migration preserves existing signing and reconciliation records. Admission errors identify the per-transaction budget, daily budget, signer balance or safe block gas limit separately. Daily allowance resets at 00:00 UTC.

The product is named **WeldPoint**. Historical `taser-*` commitment domains, Arkiv schema/release identifiers and the configured verifier-secret binding remain unchanged for compatibility with existing public records; they are not display names.
