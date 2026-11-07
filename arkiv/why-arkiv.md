# Why Arkiv

Arkiv gives WeldPoint's shared content a public publication identity and a network-enforced lifetime. This matters because published puzzles must stay fixed for their replays to make sense, and community feedback decides which levels remain available.

## What users would lose with a plain Postgres replacement

**An externally inspectable publication record.** Levels, winning runs, and committed move pairs have Arkiv entity keys and transaction references. The UI links to their publication evidence. Public readers can inspect routing metadata, the signing wallet, immutable flags, and expiration without asking our private SQL server for those facts. A plain private Postgres deployment would put that evidence entirely under the game operator's control.

**A network-enforced community retention rule.** New campaign and community levels start with two hours. Each distinct authenticated operator can heart a publication once, causing the owner signer to extend its actual Arkiv deadline by one hour. A confirmed heart changes how long a chamber remains available for new players. Postgres could reproduce the UI and schedule deletion, but the retention rule would be enforced solely by our service. Account uniqueness and heart eligibility are still application rules; Arkiv enforces the resulting ownership and expiration operation.

**Stable, immutable content identities for replay compatibility.** A winning run names the exact level entity key it was verified against. Published entities are readonly; changes require another publication. Solo mode reads the selected run from Arkiv and rejects a mismatch. Postgres can implement versioning too, but would need an additional public publication and integrity mechanism to preserve the same independently inspectable record.

**Retrievable content outside one local catalog database.** With the same publisher, namespace, and encryption key, our server can rebuild its confirmed level catalog from live Arkiv entities. Public theme publications point to hash-checked Swarm manifests and artwork. Losing the local projection does not by itself erase live publications. This does not recover private accounts, completion history, encryption keys, or expired entities.

The distinction is where these guarantees are enforced. Postgres can support a similar game with additional infrastructure; Arkiv supplies the publication, ownership, and lifetime surface we build on.

## Where gameplay actually depends on Arkiv

- Starting a published challenge validates the current Arkiv level entity before pinning the session snapshot.
- Selecting a player replay reads and validates that run's exact-revision evidence from Arkiv.
- Confirmed paired-turn reads supply the in-game transaction strip, rather than merely writing an unused log.
- A heart extends the real entity deadline, which controls future discovery and starts.
- Theme loading reads a trusted Arkiv pointer before retrieving the declared Swarm release.

See [how we use Arkiv](how-you-use-arkiv.md), [schema and queries](schema.md), and [Swarm evidence](swarm.md).

## What we keep off Arkiv, and why

| Data or responsibility | Location | Reason |
| --- | --- | --- |
| Live parties, invites, ready states, queued inputs, and active simulation | Application-server memory | Players need immediate coordination; confirmation is outside turn processing. Completed turns are archived asynchronously. |
| Accounts, SIWE challenges, demo password hashes, and session credentials | Private SQLite | Authentication and revocation need private, application-controlled state. |
| Verified completion history, score tables, heart deduplication, and query projections | Private SQLite | Provide access checks, progress that survives content expiry, and relational queries not currently executed by Arkiv. |
| Draft recovery, pending runs/moves, transaction journal, and fee accounting | Private SQLite | Recover after interruption and distinguish pending work from confirmed publication. |
| PNGs, theme manifests, and release indexes | Swarm, with bundled artwork fallback | Large public assets belong in file storage. Arkiv carries their references and integrity hashes. |
| Signing/encryption keys and verification-service credentials | Server-only configuration | These must never be published or bundled into browser code. |
| Solution verification execution | Deterministic engine and configured CRE path | Arkiv stores the resulting encrypted publication; it does not independently execute or certify the puzzle solver. |

Full layouts and reference solutions **do live on Arkiv as encrypted payloads**. Encryption happens before SDK encoding. Unlocked solutions are disclosed through the authenticated server's access rules. Arkiv is public storage, not a private database, and the operator holds the decryption key. The thirteen legacy seeds remain visible in source history; encryption cannot make those previously published solutions secret.

The server wallet owns the entities. Player authorship, editing permissions, score correctness, and verification-label honesty remain application responsibilities. We do not claim user-wallet ownership of each puzzle, fully on-chain gameplay, public plaintext replay access, or independent Arkiv verification of a win.
