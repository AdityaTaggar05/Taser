# Public co-op arena and test-point predictions

This branch adds an opt-in public arena at `#watch`. It uses points with no cash value; no wallet escrow, token transfers, payouts in cryptocurrency, or betting contracts are implemented. Wallet sign-in and Atlas/Nova demo sign-in use the existing authentication flow.

## Try it locally

Use Node 22.13+ (the installed Node 26 works), then `npm run dev`. Alternatively build and use `DEMO_AUTH=true npm start` to enable Atlas and Nova in the production server. Open independent browser profiles: two operators and a spectator. The spectator needs a different account; the same Atlas/Nova identity cannot predict its own match. A wallet account can be the third identity.

1. Host a co-op party and invite the other operator.
2. Both operators enable **Broadcast this attempt publicly**. Private parties are not listed.
3. The spectator opens **Watch & predict** and chooses a match or **Watch random match**.
4. Each spectator can stake 10–100 whole test points on Escape or Fail once per attempt. Accounts begin with 1,000 points. Maximum 200 predictions per pool.
5. Both operators confirm Ready; the host starts. Predictions close synchronously before play starts.

Public attempts disable undo. Reset counts as failure and finishes the attempt; return to the lobby to create another. Returning clears both broadcasting consents. Leaving, reconnect expiry (45 seconds), a two-minute idle lobby, the ten-minute public-play limit, and server restart void unsettled pools and refund stakes. With no predictions on the winning side, all stakes are refunded. Otherwise the entire pool is distributed proportionally to correct predictions, with deterministic integer rounding. Settlement is idempotent and does not mint extra points.

Known participant accounts cannot watch or predict their own matches. This does not prevent alternate wallets, collusion or deliberate losses, which is why these points have no monetary value. A funded betting product would require a separate escrow contract, a defined result-verification/oracle model, and a stronger integrity design.

## Spectating and privacy

The authenticated HTTP API polls public matches. Board snapshots arrive after a 10-second delay. Only accepted state is shown; queued inputs, reference solutions, hidden weld targets, account IDs and invite codes are excluded. Both operators explicitly consent to exposing both board perspectives. This feed can still help a player using an alternate account; public matches do not preserve the private co-op information boundary.

Pool status and settlement are immediate; the board feed is delayed. Active/disconnected private games remain private. Random selection uses server cryptographic randomness over eligible public matches; it is not a verifiable on-chain draw.

## Arkiv attempt history

The existing puzzle publication lifetime remains unchanged. Attempts have their own named schema, `weldpoint_attempts_v1`, to keep older level loaders compatible. The server journals an encrypted cumulative transcript for the opening, each committed turn, and the terminal result. Active attempts also emit a heartbeat approximately every 50 seconds. These immutable records include an attempt ID, sequence, previous hash and transcript hash inside the encrypted envelope.

Transient records target a fixed block roughly two minutes after observation. A retry keeps that original deadline. Losses never renew; records remain queryable until their expiry. Failed local payloads are pruned after that interval, while the existing private signing journal retains reconciliation data. Expiration is not a promise that historical copies or backups disappear.

On victory the complete transcript is independently replayed, then a separate winning-attempt entity targets the published level's current expiration. Background retention extends winning entities after level hearts extend that publication. Expired entities cannot be revived; prolonged downtime, exhausted fee budgets or failed extensions can leave an archive pending or let it expire. There is no literal forever lifetime and no unheart/revocation feature in this version.

Writes reuse the existing dedicated signer, fee limits, daily budget, durable signed-transaction journal and receipt/readback verification. Gameplay does not wait for chain confirmation. The UI distinguishes pending from confirmed archival. Up to eight queued writes are attempted per maintenance pass. Under load, old unsigned transient records can expire before being submitted. An already signed write is reconciled by its original hash; an expired canonical write is marked expired rather than resubmitted or reported as archived. Pending entries rotate through bounded batches so one unavailable record cannot starve every other attempt. Winning archives are processed first within each batch.

No migration or automatic seeding is needed. The points ledger and unsettled-pool recovery use private SQLite. Unlike monetary escrow, they are server-authoritative and not backed by a token.

## HTTP API

All endpoints are under `/api/auth/:tabContext/betting` and require the existing session cookie. POSTs require same-origin JSON. Responses are never cached.

- `GET /`: balance and recent public matches, excluding the participant's own matches.
- `GET /random`: a randomly selected open or running public match.
- `GET /:matchId`: pool, delayed board, archive status and the caller's own prediction.
- `POST /:matchId/predict`: `{ "outcome": "escape" | "fail", "amount": 10..100 }`.

No endpoint accepts a client-provided winner, settlement command, archive payload or points balance. Each co-op operator controls only their own broadcasting consent through their authenticated socket.

## Validation

Automated tests cover consent, public/private isolation, close-at-start behavior, stake validation, duplicate prevention, conservation and rounding, payouts/refunds/restarts, delayed projection privacy, encrypted partial transcripts, fixed expiry encoding using the real SDK, expired receipt recovery, verified-win retention and heart extension. A three-account browser playtest also exercises public lobby opt-in, prediction submission, a full winning game, settlement and desktop/mobile spectator layouts using an isolated in-memory archive without spending testnet fees.
