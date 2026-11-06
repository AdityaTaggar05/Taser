# Arkiv leaderboards and expiration

## Repository findings

WeldPoint uses TypeScript, Phaser 3, Vite, plain DOM screen classes and existing CSS files. Hash routes live in `src/main.ts`; `AuthClient` and `LevelClient` call authenticated same-origin Node HTTP APIs. Vitest covers the deterministic engine, authentication, sessions, editor and Arkiv archive. There is no formatter/linter script. The shell defaults to Node 20; development and verification require the installed Node 26 (SQLite), per README's Node 22.13+ requirement.

`server/arkiv/ArkivArchive.ts` is the sole runtime writer: SDK **1.0.1**, Rabdi **7794095**, native address `0x4400000000000000000000000000000000000044`. It uses a dedicated server EOA, keyed RPC, encryption, exclusive signer lock, serialized writes, unsigned exact-calldata estimates, fee/balance caps and a durable SQLite transaction journal. `config.ts` loads server-only `ARKIV_*` variables; `.env.local` and `.data` are ignored. Never expose their contents. Migration/setup/check scripts reuse this configuration; artwork uses Swarm separately.

The named `weldpoint_levels_v1` schema indexes namespace, record ID, revision and category. Entire level/replay payloads (including solutions) are encrypted in a bytes attribute; only trusted creator/readonly publications are accepted. `LevelStore` projects confirmed publications into private SQLite. Draft saves and publication create separate immutable revisions. Sessions pin a publication and independently verify winning witnesses. SIWE wallet accounts and demo accounts have stable server IDs. Co-op wins populate `level_wins` by publication and authentication's `completions` by campaign slot; solo wins archive a human run but do not unlock campaign progress.

## Verified SDK semantics and sources

Read the [official first-entity guide](https://docs.arkiv.network/start-here/first-entity/), [expiration guide](https://docs.arkiv.network/writing/expiration/), [change/delete guide](https://docs.arkiv.network/writing/change/), [batches](https://docs.arkiv.network/writing/batches/), [pagination](https://docs.arkiv.network/querying/paginate/), [sorting](https://docs.arkiv.network/querying/sort/) and the [official skill catalog](https://skills.sh/arkiv-network). The best-practices entrypoint redirects to the [SDK 1.0.x router](https://github.com/arkiv-network/skills/blob/main/skills/arkiv/SKILL.md); expiration, query, write-safety and app-integration recipes were consulted. Cross-checked installed SDK README, wallet actions, expiry resolution, entity flags, query builder, events and block-timing types.

- **Use installed 1.0.1 signatures**: `createEntity(schema, values, {expiration, flags, salt}, txParams)` and `extendEntity({entityKey, expiration}, txParams)`. There is no `expiresIn`, separate payload/annotations interface, `updateEntity`, or `buildQuery` in this SDK. Some online generated reference pages still say `expires`; the installed types and current prose guide say `expiration`.
- Extension **sets a deadline**, rather than adding a duration. `fromHours(1)` would count from transaction inclusion and can shorten an existing deadline, causing rejection. Add `HEART_EXTENSION.minLifetime` to a fresh `$expiresAt`, then use `ExpirationTime.atBlock(target)`.
- Durations resolve to blocks at nominal two-second intervals. `LEVEL_BASE_TTL = ExpirationTime.fromHours(2)` and `HEART_EXTENSION = ExpirationTime.fromHours(1)`. The chain enforces a maximum remaining lifetime (`ExpirationTime.max()`); hearts cannot exceed it or revive expired entities.
- Only the owner may extend unless immutable `permissionlessExtension` was enabled at creation. Retain `readonly:true, permissionlessExtension:false`; authenticated hearts use the existing owner signer. This also serializes competing heart requests.
- `patchEntity` changes attributes without changing expiry; readonly publications cannot be patched. `deleteEntity` requires owner authority. `executeBatch` is atomic for its native operations; separate transactions are not. No patch/delete is needed here.
- Reads expose `$expiresAt` as a block height. Creation and extension receipts carry actual `expiresAt`. Expired entities disappear from current-state queries and cannot be extended. Missing data alone cannot prove expiration rather than deletion or network failure.
- Queries use `select().from(schema).where(and(eq(...), gt(...))).orderBy(asc(...)).limit(100).fetch()`. Only indexed columns filter; only one sort key is supported. Offset pagination exists; there is no historical snapshot/cursor API. Retain the existing bounded keyset scan with strict mismatch handling.

## Decisions for the truncated task

The supplied task ends at “extend ... lifetime by”; use its explicit one-hour constant. New published levels (community **and campaign**) start at two hours. Private drafts keep maximum retention, and replay runs keep two-day retention. Existing chain entities retain their original deadlines; changing application policy cannot shorten immutable old publications.

Hearts are permanent per account and exact publication key, with no unheart/reheart farming. Count a heart only after a verified extension receipt and readback. Preserve stable operation IDs in the existing journal so retries, concurrent requests, lost responses and restarts cannot double-extend. Keep private account IDs off chain and out of leaderboard DTOs.

Global ranking counts distinct co-op chambers completed, retaining historical progress when a publication expires; repeated wins/revisions do not farm progress. Include existing campaign progress. Per-level ranking shows one best server-verified turn count per player, with separate co-op/solo filters, earliest winning timestamp then stable account ID as tie breakers. Verified results remain valid while run publication is pending. Expired level boards reject new reads/hearts/starts; a running pinned session may finish as before.

Show the real expiry block with an explicitly estimated wall-clock countdown derived from fresh chain head and SDK nominal block time. Poll while visible, handle failure as unknown, and confirm expiration against chain state rather than a browser timer. Never claim an exact wall-clock deadline for block-based expiration.

Implementation and validation evidence is recorded below as the work is completed.
