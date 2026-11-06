# Arkiv activity and move records

Challenge browsing, solo replay selection/player runs and the level creator share a minimizable activity explorer. Running levels use the paired-move database explorer beside the timeline, described below. This branch has player-run lists rather than a separate global leaderboard; the player-run lists now expose publication transaction and entity links. Draft saves, community/campaign publications, winning runs and completed gameplay turns appear in the account's activity timeline. Read references are listed separately and never counted as writes.

## Arkiv trace

| Flow | Reads | Writes |
| --- | --- | --- |
| Server startup | Reconcile saved receipts; trusted encrypted catalog traversal | No automatic seed/migration |
| Campaign/community discovery | SQLite projection plus cached fresh chain head | None |
| Start/replay/reconnect | Starts validate the level entity; player echoes also read their run entity. Reconnect resumes the pinned room. | None from joining/reconnecting |
| Gameplay | Server simulation; no RPC in move handling. The move strip queries committed records asynchronously every three seconds. | One encrypted `move` entity per completed P1/P2 turn |
| Winning run | Independently verifies the recorded solution | Existing durable run queue, now also tracked in activity |
| Creator templates/reference solutions | Authenticated entity read and decryption after existing access checks | None |
| Creator save/publish | Existing layout and solution validation, receipt verification and encrypted readback | Encrypted draft and community/campaign entities, now tracked in activity |
| Migration/quote CLI | Catalog, unsigned estimates, readback | Only explicit migration writes. Quote does not broadcast. No app screen invokes it. |
| Swarm asset tooling | Bee reads/verification | Separate explicit Bee upload; no Arkiv transaction initiated by its UI |

Implementation boundaries: `CoopRoom` emits a turn only after the engine advances; `Sessions` supplies its match identity and both participant IDs; `LevelStore` durably enqueues it; `ActivityStore` calls the existing `ArkivArchive.put`. The authenticated `/levels/activity` endpoint returns the most recent 60 writes for the requesting account, without move contents, account IDs, layouts or credentialed RPC URLs. Both co-op participants can see their shared turn receipts; unrelated accounts cannot.

## Decisions

- A pair means one completed turn containing P1 and P2, including Wait. A solo echo provides the partner input. Queued, replaced, cancelled, rejected or stale commands are not completed turns. Accepted turns ending in a gameplay failure are still recorded.
- Each room has a monotonic event sequence, independent of engine turn/revision. Undo, reset, returning to the lobby and level changes do not reuse event identities. Replaying an undone turn creates a new historical event. Reconnect does not create one. Existing immutable records are not deleted or rewritten by undo/reset.
- Public record IDs are opaque hashes of match and event sequence. Match/revision references, sequence, turn, mode, both move directions and account identity are encrypted with the existing key. Move records contain no puzzle copy or future replay inputs.
- The local outbox freezes the original intent before asynchronous signing. Duplicate requests reuse that intent, including its timestamp. A lost send response uses the journal's original signed hash; no automatic second send is introduced.
- Pending means queued or awaiting verification. An unknown send result remains pending with its known transaction link. Pre-broadcast failure or a reverted receipt shows failed, with safe diagnostics. Confirmed requires the existing canonical receipt checks and authenticated encrypted readback. A reconciled verified result takes precedence over a stale error.
- Activity uses the same signer serialization, dedicated-signer lock, journal, maximum transaction fee and daily fee reservation. Gameplay never waits for RPC or confirmation. The first turn starts a bounded worker; additional queued work and recoverable failures are processed in batches of four by the existing ten-second maintenance loop. Winning-run publication keeps its separate recovery queue.
- The panel polls every three seconds while a covered screen is visible, remembers its expanded preference, and cancels its request/timer/subscription when hidden, signed out or destroyed. It is minimized initially. Keyboard Enter/Space toggle it and Escape minimizes it without triggering gameplay shortcuts. Expanded content scrolls within the viewport; minimize it to reach any content underneath.
- Rabdi is the application's configured chain, ID 7794095. Transaction and entity deep links use `/tx/<hash>` and `/entity/<key>` on its explorer; only valid 32-byte references are linked. Public explorer routing was inspected. Locally known verified transaction hashes survive catalog hydration; historical entities discovered without a known hash expose only their entity link.
- Test adapters explicitly display TEST / simulated result and suppress explorer links. Browser link checks use responses labelled Mock; they are not live-chain verification.

## Arkiv setup changes

No new keys, environment variables, RPC endpoint, dependency versions or on-chain schema deployment are required. The existing `weldpoint_levels_v1` entity schema gains an application-level `move` category. Its encrypted payload validator now accepts move records. Catalog scans continue to select only drafts, levels and winning runs, so gameplay records never enter discovery or replay lists.

`arkiv_activity` is created automatically in the existing private account/level SQLite database. Preserve that database **and** the existing Arkiv signing journal when backing up the server. Recovery rows contain plaintext move pairs under the same private local-storage boundary as existing level/run recovery. Chain payloads stay encrypted. Move entities use the existing 48-hour nominal lifetime; drafts/campaign lifetime policies remain unchanged. Local recovery/activity history is retained; this change does not prune it automatically.

The actual `.env.local`, keys, account database and live journal were not modified by this work. Fee caps were not raised. Gameplay now needs approximately one additional transaction per completed turn, in addition to draft/publication/winning-run writes. Review expected match volume, fund the existing signer with test tGLM and choose appropriate existing fee limits. `arkiv:quote` still estimates campaign migration, not a daily gameplay budget. Exhausted caps, unavailable RPC or unresolved signed transactions can leave a backlog; the UI reports this honestly and gameplay continues. Do not delete the journal or rotate keys to bypass it.

## Validation

- 155 automated tests pass, covering move pairing, rejected/cancelled/stale inputs, both solo roles, undo/reset/level changes/reconnect, durable restart recovery, frozen intent deduplication, gated confirmation without blocking moves, encrypted calldata, lost replies, readback failure, reverted receipts, authenticated status propagation and audience isolation. Existing gameplay/editor/auth/run/socket regressions pass.
- Production TypeScript check and Vite build pass. The existing Phaser bundle-size warning remains.
- Headless Chromium exercised the production build with real HTTP/WebSocket gameplay and an explicit in-memory archive: keyboard minimize/expand/Escape, route navigation, solo play, undo/reset/reload reconnect, write failure/recovery, winning-run publication, creator save and stopping polling on home. Narrow viewport: 390 × 844, no panel overflow, no page errors.
- A second two-account Chromium check passed co-op lobby/Ready/start, partial/cancelled pairs, shared participant activity, reset and guest reconnect at desktop and narrow viewports, using only the test archive.
- Separate mocked live-style activity and player-run responses verify pending/confirmed/failed rendering and exact explorer URLs. No live-chain write or live receipt confirmation was performed.

Reproduce the primary browser check after `npm run build`:

```sh
node --import tsx scripts/browser/block-explorer.fixture.ts
# In another terminal, with Playwright and Chromium installed:
node scripts/browser/block-explorer.mjs
# Focused paired-move query, polling, undo/reset and mobile checks:
node scripts/browser/paired-moves.mjs
# With a fresh fixture, optionally run the two-account co-op check:
node scripts/browser/block-explorer-coop.mjs
```

The fixture uses port 5191, only in-memory test storage, and never loads `.env.local`. Playwright is optional and not added to application dependencies. If it is installed outside this repo, set `PLAYWRIGHT_MODULE_PATH` to its absolute `index.mjs` path. Screenshots are written to `/tmp/block-explorer-*.png`.

## Paired-move database explorer

Gameplay now uses `MoveSequence` beside the timeline, replacing the floating activity panel during a level. Each active committed turn has exactly two cells (P1 and P2), with arrows or WAIT. The strip scrolls horizontally and wraps below the timeline on narrower screens. Selecting a pair reviews the operator's board at that turn.

The authenticated `GET /levels/moves/:sessionId?sequences=1,2` endpoint accepts at most 32 unique positive sequence IDs. SQLite first restricts records to that session and the requesting participant's audience. Confirmed records are fetched afresh with the existing Arkiv client's typed query builder, scoped to the trusted creator, namespace, move category and exact record IDs. Decryption, publication policy, content and entity identity checks precede returning the two committed directions. No credentials, puzzle layouts, player account IDs or future/queued inputs are returned. Missing chain entities show Unavailable rather than reusing cached directions as confirmed. Test adapters show TEST and do not link fake transactions.

Polling happens immediately when the active sequence changes and every three seconds thereafter, with no overlapping requests. Route, account and sequence changes abort outstanding requests; generation checks discard late replies. Hidden tabs stop querying until visible again. Query failures mark displayed data stale and retry; they never initiate writes. `CoopRoom` supplies only active sequence IDs, trimming on undo and clearing on reset, lobby return and level changes; immutable historical move records remain intact.

Verification adds real SDK query-encoding/provenance tests, participant/session isolation, bounded request validation, missing-entity handling and active-sequence undo/reset tests. Chromium checks with the explicit in-memory HTTP/WebSocket fixture cover paired arrows, three-second polling without new moves, undo/reset, query outage/recovery, mobile containment and polling cleanup. These checks do not claim live Rabdi availability. CRE is not part of this change.
