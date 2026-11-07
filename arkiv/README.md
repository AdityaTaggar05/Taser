# Arkiv submission guide

WeldPoint / Taser is a temporal co-op puzzle game with encrypted community levels, reusable winning replays, level lifetimes extended by community hearts, and public Swarm artwork selected by Arkiv entities. Submission target: **Build on Arkiv (from scratch)** and the **Arkiv + Swarm bonus**. [Official criteria](https://ethglobal.com/events/mumbai/prizes/arkiv).

## Judging criteria and evidence

| Criterion | Document | What to inspect |
| --- | --- | --- |
| Arkiv feedback — 25% | [friction.md](friction.md) | Observed issues, expected/actual behavior, reproduction paths, and database capability requests. |
| Reach — 25% | [reach.md](reach.md) | Intended players, playable local flow, evidence limits, and plans after Mumbai. |
| Why Arkiv — 25% | [why-arkiv.md](why-arkiv.md) | Benefits of public publication/expiration and what remains off Arkiv. |
| How we use Arkiv — 25% | [how-you-use-arkiv.md](how-you-use-arkiv.md) | Queries, ownership, expiration, visible features, and trust boundaries. |
| Entity definitions | [schema.md](schema.md) | Both schemas, indexed/encrypted fields, owner, lifetime, and predicates. |
| Arkiv + Swarm bonus | [swarm.md](swarm.md) | Current entity/reference pairs, upload/read commands, files, and outstanding postage/video evidence. |

The [main README](../README.md#arkiv-submission-and-runnable-query) contains the publisher wallet and a runnable native Arkiv query. [Public repository](https://github.com/AdityaTaggar05/WeldPoint).

## Audit findings and verification

This documentation audit on **2026-11-07 UTC** checked claims against the implementation.

- Added the missing `schema.md` and `how-you-use-arkiv.md` documents and expanded the three criterion drafts.
- Corrected ownership: the server signer owns entities; player author permissions are application rules.
- Corrected expiry: new levels start with two hours and hearts add one hour; runs and moves have two-day lifetimes, including moves from failed attempts.
- Distinguished native Arkiv queries from local SQL projections and encrypted fields that cannot be filtered natively.
- Replaced stale Swarm 1.0.0 evidence with both active 1.1.0 deployments, each with 29 PNGs, and documented the current local-artwork fallback.
- Ran the README's theme-query payload with the configured access key: four publications returned, including both current 1.1.0 pointers. The keyless query encountered HTTP 429.
- Read both Swarm releases/manifests and checked recorded hashes, plus one PNG's size/hash per theme. Earlier full-file verification remains in linked release evidence.

No transaction was sent, no content was republished, and no deployment is implied by this audit. Source/test links show how behavior is covered; they do not imply a new full application test run.

## Submission details still needed

| Item | Status and action |
| --- | --- |
| Public repository | GitHub reports the repository as public. Publish these local documentation changes on the submitted branch. |
| Open-source license | No root license file was found; GitHub reports no detected license. The team must choose and add an appropriate open-source license. |
| Public play URL | Not supplied in the repository. Add a reachable Node/WebSocket deployment URL to [reach.md](reach.md). |
| Demo video | Add the video link and exact moment showing Swarm reads to [swarm.md](swarm.md). |
| Swarm postage attribution | The gateway supplier is recorded, but batch ID and specific funding-wallet/operator confirmation remain missing. Request these from the operator. |
| AI-use disclosure | The main README records Codex's documentation-audit role. Complete it with any other AI use in implementation, design, or artwork. |
| Event eligibility | The team must confirm from-scratch work and event-rule compliance. This audit does not independently establish event provenance. |
| Operational availability | Recheck short-lived levels and both theme endpoints before judging. Arkiv expiry and Swarm retention are separate. |

Required documentation paths are now present. The missing license and submission-specific evidence still need completion before claiming full qualification.
