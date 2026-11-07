# Why Arkiv

Arkiv gives WeldPoint's shared puzzles and replays a public publication identity and a network-enforced lifetime. Those properties support the game's core loop: creators publish challenges, players contribute winning replays, and community hearts keep popular levels available.

## What Arkiv adds

**Public publication evidence.** Levels, winning runs, and committed move pairs have entity keys and transaction references that players can inspect through the game. Public metadata exposes the publisher, immutable flags, and expiration, making publication status independently checkable.

**Community-driven availability.** New levels start with a two-hour lifetime. Each distinct authenticated operator can heart a publication once, prompting the owner signer to add one hour to its actual Arkiv deadline. Community feedback therefore changes how long a challenge remains available. The application checks heart eligibility; Arkiv enforces ownership and the resulting expiration.

**Exact versions for reusable replays.** Published levels are immutable, and each winning run references the exact level entity key it was verified against. Solo mode retrieves a complementary replay from Arkiv and checks that it matches the selected revision. Updating a puzzle creates a new publication, preserving the identity of the original challenge.

**Shared content that can be rediscovered.** The server can rebuild its confirmed catalog from live Arkiv entities using the same publisher, namespace, and encryption key. Arkiv also holds trusted theme pointers to hash-checked Swarm manifests and artwork. Recovery covers live published content; private account data, lost keys, and expired entities require separate handling.

Together, these features give WeldPoint a shared publication layer whose content identity, ownership, and lifetime can be inspected beyond the game server.

## Where players use it

- Starting a published challenge validates its current Arkiv entity before the session begins.
- Choosing a solo partner retrieves a winning replay for that exact level revision.
- The in-game transaction strip displays confirmed paired-turn publication evidence.
- Hearts extend level availability for future discovery and play.
- Theme loading follows a trusted Arkiv pointer to its Swarm release.

## Supporting application services

Live coordination and simulation run on the application server so turns respond immediately; completed turns publish asynchronously. Private storage supports authentication, player progress, rankings, heart deduplication, and publication recovery. Swarm stores public artwork, while server configuration holds signing and encryption keys.

Full level layouts and reference solutions live on Arkiv as encrypted payloads. The server controls solution access and owns the published entities. Player permissions and win verification remain application responsibilities, with verification performed by the deterministic engine and configured CRE path. Arkiv provides publication and lifecycle enforcement; encryption does not conceal legacy solutions already visible in source history.

See [how we use Arkiv](how-you-use-arkiv.md), [schema and queries](schema.md), and [Swarm evidence](swarm.md).
