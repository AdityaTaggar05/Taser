# Arkiv feedback

WeldPoint is a two-player puzzle game with community-authored levels, reusable winning replays, and hearts that extend a level's lifetime. We use `@arkiv-network/sdk` **1.0.1** on **Rabdi, chain ID 7794095**. Our main request is to make building a responsive application on Arkiv require less database and transaction infrastructure in our backend.

This document separates integration friction, reproducible cases, and proposed capabilities. We have not measured a write-latency distribution and do not claim that every pending write is an Arkiv failure.

After installing dependencies with Node.js 22.13+, run the referenced failure/recovery fixtures with:

```sh
npm test -- tests/arkiv.test.ts tests/moves.test.ts tests/runs.test.ts
```

These tests use controlled transports or an explicit in-memory archive; they do not spend tGLM or require our private configuration.

## 1. Write confirmation takes longer than a gameplay interaction

**Expected:** committing a turn or finishing a puzzle should update the game immediately, while durable publication has an understandable status.

**What got in our way:** waiting for a transaction, receipt, and readback on the interaction path made responsive gameplay difficult. A successful game action and a confirmed archive write are different events. Assuming publication succeeded would give players misleading transaction evidence.

**Our workaround:** simulate the turn immediately, save an outbox entry in SQLite, and publish asynchronously. The UI distinguishes pending, confirmed, failed, and unavailable records. Winning runs become discoverable only after confirmation. An uncertain transaction is reconciled by its original hash rather than sent again.

**Reproduce:** finish a turn or win while writes are blocked by a fee cap or a network interruption. Gameplay should advance; archive status should remain pending or failed. The deterministic cases are in [move tests](../tests/moves.test.ts) and [run recovery tests](../tests/runs.test.ts). These simulate failures; they are not live-network benchmarks.

**Request:** an asynchronous-write recipe with durable intent IDs, submission/receipt/readback states, restart recovery, and measured confirmation timings. SDK support for this lifecycle would remove substantial application code. See [our outbox](../server/arkiv/ActivityStore.ts) and [transaction journal](../server/arkiv/ArkivArchive.ts).

## 2. Explain the entity/schema model for database developers

We initially had trouble understanding what a named schema means, how entities are retrieved, which attributes are indexed, and where application validation belongs. A schema looks familiar to a SQL developer, but it does not provide the isolation or ownership guarantees of a private table.

**Concrete case:** as levels and replay records began sharing a schema and namespace, an overly broad catalog query brought unsupported records into level hydration. Startup failed instead of loading the intended catalog. This was our query-scoping error, not evidence that Arkiv corrupted data. The fix explicitly selects supported categories and retains strict creator, immutable-flag, and payload validation.

**Reproduce:** use the mixed-category fixtures in [Arkiv tests](../tests/arkiv.test.ts), especially `loads supported level and run categories from a mixed archive across pages and still rejects untrusted levels` and `scopes the level catalog query to level categories when other feature records share the namespace`.

**Request:** one example covering multiple entity categories, schema evolution, indexed versus unindexed fields, and creator-scoped reads. Explain how a schema tag, application namespace, and trusted publisher serve different purposes. Warn that another wallet can copy public schema tags.

## 3. Stronger queries would reduce our local SQL dependency

The [documented query language](https://docs.arkiv.network/reference/query-language/) provides attribute predicates and a single sort field. We would benefit from these additions, in priority order:

| Capability | What it would enable in WeldPoint |
| --- | --- |
| Relationship lookups or native joins | Fetch runs associated with a level or author without stitching several result sets together. |
| Grouped aggregations: `GROUP BY`, distinct counts, `MIN`, `MAX`, `SUM`, and `AVG` | Compute completion statistics, best runs, and creator activity closer to the stored data. Counting matching entities already exists; our request is for grouped and richer aggregation. |
| Multiple sort fields | Order scores by fewest turns, earliest achievement, then a stable identifier. |
| Snapshot-consistent pagination | Traverse a catalog while entities are created or expire, with a clear consistency guarantee. Our current `$key` cursor traversal is not a historical snapshot. |
| Unique/composite-key constraints or conditional inserts | Enforce a single logical revision or idempotent operation across multiple writers. We currently handle duplicate detection and operation IDs ourselves. |
| Query diagnostics | Inspect index use, examined entities, and execution time before a catalog or leaderboard becomes slow. |

These are capability requests, not claims that `JOIN` or `GROUP BY` currently works. The [read API](https://docs.arkiv.network/json-rpc/querying-data/) documents the pagination behavior we work around. Arkiv already supports atomic native-operation batches; the constraint request is additional to that functionality.

There is a privacy tradeoff: our run-to-level relationship, role, player identity, and scores are inside encrypted payloads. Joins cannot inspect those fields as stored today. Using richer native queries would also require deliberately exposing suitable public indexes or maintaining privacy-preserving projections. Current [leaderboard projections](../server/levels/LevelStore.ts) execute in local SQLite.

## 4. Make expiration extensions and relationships easier to use

**Expected:** a heart adds one hour to the level's existing deadline.

**API pitfall:** `ExpirationTime.fromHours(1)` expresses lifetime relative to inclusion; it does not add an hour to an existing expiration. It can request an earlier deadline and be rejected. This is an integration pitfall, not a confirmed protocol defect.

**Our implementation:** read the live expiration, add `HEART_EXTENSION.minLifetime`, and use `ExpirationTime.atBlock(target)`. Serialize hearts through the owner signer and deduplicate by account/publication. See [expiration constants](../server/arkiv/expiration.ts), [writer](../server/arkiv/ArkivArchive.ts), and [extension tests](../tests/arkiv.test.ts).

Runs live for two days while new levels start with two hours, so a run can physically outlive its parent. We enforce availability at the application boundary. Expiration also does not erase downloaded copies or private completion history.

**Request:** an explicit “extend from the current deadline” helper, documented concurrent-extension behavior, and examples for expiring parent/child records. Lifecycle diagnostics that distinguish known expiration/deletion from transport failure would improve user-facing messages; a missing current-state record alone cannot explain its absence.

## 5. Provide a persistent recovery reference implementation

**Expected:** retrying after a lost response should safely recover the original operation.

**Case we test:** broadcast succeeds but its reply is lost, or the receipt succeeds while readback fails. We retain signed bytes, transaction hash, frozen intent, and receipt phase before proceeding. We never automatically broadcast another copy to resolve uncertainty.

**Reproduce:** [Arkiv tests](../tests/arkiv.test.ts) include `journals signed bytes before forwarding and reconciles a lost reply without a second send` and `preserves receipt confirmation across readback failure and resumes verification without resending`.

**Request:** an official persistent recovery adapter or example with idempotency, nonce management, and partial-success handling. This would help teams avoid independently rebuilding our [writer journal](../server/arkiv/ArkivArchive.ts).

## 6. Distinguish RPC access from the funded signer during onboarding

An access key, the wallet used to obtain it, and the wallet signing application transactions are separate identities. Funding the first wallet does not fund a newly generated server signer.

**Reproduce:** configure a valid access key and an unfunded application signer, then run `npm run arkiv:check`. Reads can work while the check reports that the signer needs tGLM. Our [preflight script](../scripts/arkiv-check.mjs) prints the public signer and balance without sending a transaction.

**Request:** put “fund this exact signing address” beside first-write examples and provide one preflight for chain ID, access-key validity, signer balance, and a fee estimate.

## 7. Make public RPC throttling easier to diagnose

During this documentation audit on **2026-11-07 UTC**, the public RPC answered chain ID and head reads, but our theme query returned **HTTP 429**. The same query succeeded using the configured access key and returned four theme publications, including both current 1.1.0 releases. This is one observed outcome, not a reliability or throughput benchmark.

**Reproduce:** run the keyless version of the [theme query](schema.md#runnable-theme-query). Throttling depends on current traffic and may not repeat. Obtain an access key and repeat using its keyed RPC URL.

**Request:** document rate-limit scope, provide useful backoff guidance and response metadata, and make the public-to-keyed RPC transition prominent in onboarding.
