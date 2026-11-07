# Arkiv schema

Network: **Rabdi, chain ID 7794095**. SDK: **`@arkiv-network/sdk` 1.0.1**. Recorded publisher/owner: **`0xaC4d639d5C2CAD6D8c1d9d3cd1470467324764Ca`**. The default namespace is `weldpoint`; operators can override `ARKIV_NAMESPACE`.

## Encrypted game records: `weldpoint_levels_v1`

Defined in [schema.ts](../server/arkiv/schema.ts). The SDK adds the indexed `arkiv.schema` tag for this named schema.

| Attribute | Type | Indexed | Purpose |
| --- | --- | --- | --- |
| `namespace` | `str` | Yes | Application/deployment scope. |
| `record_id` | `str` | Yes | Logical identity; identifiers can still reveal relationships between revisions. |
| `revision` | `u64` | Yes | Immutable logical revision. |
| `category` | `str` | Yes | `draft`, `community`, `campaign`, `run`, or `move`. |
| `content_type` | `str` | No | Encryption-envelope media type supplied by `arkiv-encryption`. |
| `ciphertext` | `bytes` | No | Encrypted complete record and authenticated routing envelope. |

The envelope binds format version, chain ID, namespace, and routing. See [LevelCipher.ts](../server/arkiv/LevelCipher.ts) and [record types](../server/arkiv/archive.ts).

| Category | Encrypted contents beyond routing | Creation expiry |
| --- | --- | --- |
| `draft` | Author account/name, update time, draft layout, and any reference solutions. | `ExpirationTime.max()` |
| `community` | Author, complete playable level/solutions, and certification proof/salt where present. | `ExpirationTime.fromHours(2)` |
| `campaign` | Community-style publication plus its campaign slot. | `ExpirationTime.fromHours(2)` |
| `run` | Author, winning witness/level, `run.levelKey`, role, co-op/solo mode, and replay source. | `ExpirationTime.fromDays(2)` |
| `move` | Account attribution, exact level key, session ID, turn, sequence, mode, and committed P1/P2 inputs. | `ExpirationTime.fromDays(2)` |

Run/move relationships are inside ciphertext, **not public indexed columns**. There are no native player-profile, leaderboard-score, or heart entities. Hearts update a level's expiry; eligibility/deduplication records and scores live in private SQLite.

All categories are readonly with permissionless extension disabled. The server wallet owns them; application accounts control draft access through the authenticated server. A draft change creates a new entity/revision. The operator can delete community entities using its maintenance CLI. The schema does not itself enforce our application's revision uniqueness.

## Public theme records: `taser_themes_v1`

Defined in [ThemePublication.ts](../server/arkiv/ThemePublication.ts).

| Attribute | Type | Indexed | Purpose |
| --- | --- | --- | --- |
| `namespace` | `str` | Yes | Application scope. |
| `theme_id` | `str` | Yes | `modern-gray` or `diwali`. |
| `version` | `str` | Yes | Release version, currently pinned to `1.1.0`. |
| `swarm_reference` | `str` | No | Public Swarm collection containing `release.json`. |
| `manifest_sha256` | `str` | No | Source manifest integrity hash. |
| `release_sha256` | `str` | No | Release index integrity hash. |
| `content_type` | `str` | No | `application/json`. |
| `payload` | `bytes` | No | Public JSON publication with matching routing/reference/hash fields; not encrypted. |

Theme entities use the same server owner, readonly flags, and disabled permissionless extension, with `ExpirationTime.max()`. New artwork gets another versioned publication and pinned deployment reference. The browser accepts the pinned entity, not whichever record sorts latest. [Current references and hashes](swarm.md) include both themes.

## Entity fields and expiration semantics

We also read `$key`, `$owner`, `$creator`, `$creationFlags`, and `$expiresAt`. Creator-scoped filters and trusted readback prevent copied public tags from being accepted as our content. `$expiresAt` is a block height. The current maximum lifetime is 7,884,000 blocks; wall-clock countdowns are estimates.

One confirmed heart per account/publication sets the new deadline to the live expiry plus `HEART_EXTENSION.minLifetime`: 1,800 blocks, nominally one hour. New levels receive 3,600 blocks, nominally two hours. Runs/moves receive 86,400 blocks, nominally two days. Existing deadlines are not rewritten when creation defaults change. Expired records cannot be revived; parent expiration can make a live replay unusable. Implementation: [expiration.ts](../server/arkiv/expiration.ts) and [ArkivArchive.ts](../server/arkiv/ArkivArchive.ts).

## Queries judges can run

The [README](../README.md#arkiv-submission-and-runnable-query) contains a complete JSON-RPC command for the recorded publisher's public theme metadata, without our encryption key. On **2026-11-07 UTC**, it returned four records, including both current 1.1.0 publications. Availability/counts can change with expiration or deletion.

For campaign publications, pass this predicate to `arkiv_query` with `select` fields for `key`, `creator`, `expiresAt`, and `attributes`:

```text
arkiv.schema = str('weldpoint_levels_v1')
AND $creator = addr(0xaC4d639d5C2CAD6D8c1d9d3cd1470467324764Ca)
AND namespace = str('weldpoint')
AND category = str('campaign')
ORDER BY $key ASC
```

This returns routing and ciphertext, not decrypted layouts. An empty result can be valid after short-lived levels expire. Replace creator/namespace for a new deployment.

A targeted game-record lookup also adds:

```text
AND record_id = str('REPLACE_WITH_RECORD_ID')
AND revision = u64(1)
```

Place those conditions before `ORDER BY`. For another catalog page, add `$key > key(0x...)` using the previous page's last key. Move retrieval combines `category = str('move')` with an `OR` over requested record IDs, then checks decrypted records against the authorized session's expected contents. Current-state pagination is not a snapshot.

Native queries cannot search encrypted names, roles, scores, or directions. The in-game SQL presets use [a local metadata index](../server/arkiv/explorer.ts); the committed-move feed separately executes [native Arkiv queries](../server/arkiv/ArkivArchive.ts). Neither is a native SQL join.
