# How we use Arkiv

WeldPoint uses `@arkiv-network/sdk` **1.0.1** and `arkiv-encryption` **1.1.1** on **Rabdi, chain ID 7794095**. Confirmed levels and replays live in encrypted Arkiv entities; public theme entities select artwork stored on Swarm. [Schema details](schema.md) document indexed attributes, ownership, expiration, and queries.

## Features, queries, and what players see

| Feature | Arkiv operations | Visible result |
| --- | --- | --- |
| Campaign/community catalog | Query by trusted creator, namespace, and supported categories; validate into a local projection. | Published chambers are discoverable. Startup does not silently replace an unavailable Arkiv catalog with bundled campaign fixtures. |
| Starting a challenge | Re-read the entity, validate ownership/flags/payload, and check availability. | A session pins one publication. New sessions cannot silently start a different revision or unavailable level. |
| Creator drafts/publication | Encrypt the record, create an immutable revision, confirm the receipt, and verify readback. | Draft saves show archive status. New publications become playable after configured verification and Arkiv confirmation. |
| Winning player runs | Independently replay the witness, queue its encrypted record, then publish. Re-read a selected run when used. | Another player can choose a confirmed complementary run for solo mode on the exact same level publication. |
| Committed turn pairs | Queue one encrypted `move` record per completed P1/P2 turn. Query requested record IDs within creator/namespace/category scope. | The gameplay strip reads confirmed direction pairs and shows status and transaction links. |
| Community hearts | Inspect live expiry and call `extendEntity` through the owner signer. | One confirmed heart per account/publication adds one hour to the actual deadline. |
| Themes | Read the pinned public entity and validate its publisher, immutable flags, reference, and hashes. | Modern Gray and Diwali artwork load from their declared Swarm releases. |

The [archive adapter](../server/arkiv/ArkivArchive.ts), [level store](../server/levels/LevelStore.ts), [activity outbox](../server/arkiv/ActivityStore.ts), and [theme endpoint](../server/assets/ThemeApi.ts) implement these paths.

## Why these filters fit the game

`namespace` separates this application deployment from other content. `category` distinguishes private drafts, community/campaign chambers, winning runs, and moves. `record_id` identifies a logical record; `revision` selects its immutable version. A named schema contributes its schema-tag filter automatically.

Every catalog/move query also scopes the creator to the configured signer. Copied schema tags do not make another wallet's data trustworthy. Readback verifies readonly flags and encrypted routing, validates bounded game data, and replays published witnesses.

The only indexed level attributes are `namespace`, `record_id`, `revision`, and `category`. Player names/IDs, level names, run-to-level relationships, roles, scores, layouts, and moves are encrypted. We do not query those fields natively. Replay discovery, access checks, and rankings use local projections; selected publications and replays are validated against Arkiv. Theme queries use indexed `namespace`, `theme_id`, and `version`.

Catalog traversal uses pages of 100, `ORDER BY $key ASC`, and a `$key` cursor, capped at 100 pages. It fails rather than accepting an incomplete scan. This is a current-state traversal, not a snapshot. See [query feedback](friction.md#3-stronger-queries-would-reduce-our-local-sql-dependency).

## Who can edit or extend an entity?

The recorded publication wallet is **`0xaC4d639d5C2CAD6D8c1d9d3cd1470467324764Ca`**. A new installation uses its configured signer.

All publications use `readonly: true` and `permissionlessExtension: false`. Players cannot patch a published layout or replay. Draft saves create new immutable revisions; account ownership and stale-revision checks precede writing. The server owner signs extensions requested by authenticated hearts. The operator cleanup CLI can delete explicitly selected community publications; readonly does not mean undeletable. Published game identities remain locked in the application.

This is a server-signed model. SIWE identifies a player account; it does not make that player's wallet the entity owner. Players do not sign or pay for every move.

## When records expire

| Record | Creation lifetime | Application behavior |
| --- | --- | --- |
| New campaign/community publication | 2 hours | Each distinct authenticated account can add 1 hour through a confirmed heart, up to the network cap. |
| Winning run | 2 days | Its parent level must also be available for discovery or selection. |
| Committed move pair | 2 days | Same lifetime whether the attempt later wins or fails; undo/reset change the active sequence, not an existing entity. |
| Private draft revision | SDK maximum | Supports longer-lived editing and recovery. |
| Public theme pointer | SDK maximum | Swarm content has a separate retention policy. |

The maximum in our pinned SDK is 7,884,000 blocks, nominally about 182 days at two seconds per block. Existing entities retain recorded deadlines; creation-policy changes do not alter earlier publications. [Expiration constants](../server/arkiv/expiration.ts) are the implementation authority.

Discovery checks a chain head cached for up to ten seconds; new starts read the entity again. An active session can finish its pinned snapshot after expiry. New starts, per-level leaderboard reads, and hearts require an available parent. Private completion history can survive expiry. A missing record or RPC failure is not, by itself, proof of expiration.

## Confirmation, recovery, and verification boundaries

Moves do not wait for RPC confirmation. SQLite stores frozen outbox intents before background publication; the shared signer serializes writes and enforces fee budgets. The journal persists signed bytes and hash before forwarding, checks canonical receipts, and verifies readback. Unknown outcomes reconcile the saved transaction instead of automatically sending again.

Level solvability is checked by our engine and configured CRE path, separately from storage. Local CLI simulation is labeled **CRE SIMULATION VERIFIED**; it is a server attestation, not DON verification. A configured Sepolia certificate path has separate evidence requirements. See [CRE setup and trust boundaries](../docs/CRE_CERTIFICATION.md).

Deterministic coverage is in [Arkiv](../tests/arkiv.test.ts), [moves](../tests/moves.test.ts), [runs](../tests/runs.test.ts), [leaderboards/hearts](../tests/leaderboards.test.ts), and [theme publication](../tests/theme-release.test.ts) tests. Those use real SDK encoding/query construction or explicit test archives; passing them alone does not prove a live write. Recorded live evidence is linked in [Swarm](swarm.md) and [the expiration smoke test](../docs/ARKIV_LEADERBOARD.md).
