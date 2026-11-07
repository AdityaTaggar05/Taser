# Arkiv feedback

WeldPoint is a two-player puzzle game with community-authored levels, reusable winning replays, and hearts that extend a level's lifetime. We use `@arkiv-network/sdk` **1.0.1** on **Rabdi, chain ID 7794095**. Our main request is to make building a responsive application on Arkiv require less database and transaction infrastructure in our backend.

This document separates integration friction, reproducible cases, and proposed capabilities. We have not measured a write-latency distribution and do not claim that every pending write is an Arkiv failure.

After installing dependencies with Node.js 22.13+, run the referenced failure/recovery fixtures with:

```sh
npm test -- tests/arkiv.test.ts tests/moves.test.ts tests/runs.test.ts
```

These tests use controlled transports or an explicit in-memory archive; they do not spend tGLM or require our private configuration.

## 1. Make public RPC throttling easier to diagnose

During this documentation audit on **2026-11-07 UTC**, the public RPC answered chain ID and head reads, but our theme query returned **HTTP 429**. The same query succeeded using the configured access key and returned four theme publications, including both current 1.1.0 releases. This is one observed outcome, not a reliability or throughput benchmark.

**Reproduce:** run the keyless version of the [theme query](schema.md#runnable-theme-query). Throttling depends on current traffic and may not repeat. Obtain an access key and repeat using its keyed RPC URL.

**Request:** document rate-limit scope, provide useful backoff guidance and response metadata, and make the public-to-keyed RPC transition prominent in onboarding.

## 2. Write confirmation takes longer than a gameplay interaction

**Expected:** committing a turn or finishing a puzzle should update the game immediately, while durable publication has an understandable status.

**What got in our way:** waiting for a transaction, receipt, and readback on the interaction path made responsive gameplay difficult. A successful game action and a confirmed archive write are different events. Assuming publication succeeded would give players misleading transaction evidence.

**Our workaround:** simulate the turn immediately, save an outbox entry in SQLite, and publish asynchronously. The UI distinguishes pending, confirmed, failed, and unavailable records. Winning runs become discoverable only after confirmation. An uncertain transaction is reconciled by its original hash rather than sent again.

**Reproduce:** finish a turn or win while writes are blocked by a fee cap or a network interruption. Gameplay should advance; archive status should remain pending or failed. The deterministic cases are in [move tests](../tests/moves.test.ts) and [run recovery tests](../tests/runs.test.ts). These simulate failures; they are not live-network benchmarks.

**Request:** an asynchronous-write recipe with durable intent IDs, submission/receipt/readback states, restart recovery, and measured confirmation timings. SDK support for this lifecycle would remove substantial application code. See [our outbox](../server/arkiv/ActivityStore.ts) and [transaction journal](../server/arkiv/ArkivArchive.ts).

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
