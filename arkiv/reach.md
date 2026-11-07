# Reach

WeldPoint is a browser-based 2D puzzle game for people who enjoy coordinating with a friend, learning unusual mechanics, and creating challenges for others. Two operators move through opposite timelines, arrange matching boxes at the midpoint, then navigate the consequences of each other's recorded actions. Communication is part of solving the puzzle.

## Who it is for and why they would return

| Audience | Reason to play | Arkiv-backed feature they use |
| --- | --- | --- |
| Friends who enjoy co-op puzzles | Share a private invite and solve a chamber together. | Start from a confirmed campaign or community level. |
| Solo puzzle players | Play one role against a fixed creator solution or a previous winner's complementary run. | Retrieve an exact-revision winning run from Arkiv. |
| Level creators | Build, solve, verify, and share their own chambers. | Save encrypted drafts and publish immutable level revisions. |
| Competitive and community players | Compare best scores and keep good levels available. | Heart a publication to extend its actual Arkiv expiration; inspect publication evidence. Rankings themselves are computed locally. |

The community loop is concrete: someone publishes a solvable level, others complete it, confirmed winning runs become partners for solo play, and hearts extend the availability of levels people want to keep playing. More creators and more distinct successful approaches can therefore add playable content.

## Can someone try it today?

The implementation is runnable locally. A public play URL has not been supplied in this repository; add it here before submission. This document does not claim a verified public deployment.

Follow the [README setup](../README.md#run-and-connect) with Node.js 22.13+, a Rabdi access key, a funded application signer, an encryption key, and reviewed fee budgets. Reading the existing encrypted game catalog requires its original publisher/namespace/key configuration. A new installation can explicitly migrate the thirteen included campaign seeds into its own namespace. New creator publications also need the [CRE verification configuration](../docs/CRE_CERTIFICATION.md).

A short playtest:

1. Run `npm run dev` and open the printed URL. Sign in with an injected Ethereum wallet, or use the documented Atlas/Nova development accounts in separate fresh tabs.
2. Select **Play co-op**, choose a campaign chamber and role, and send the private party invite to the second account. Both players ready up; the host starts.
3. Complete a chamber. Inspect the paired-turn archive states and winning-run publication status.
4. Try **Play solo → Player runs** on that same published revision with the complementary role after a winning run confirms.
5. Open **Leaderboard & hearts**, heart an available publication once, and inspect its confirmed expiration extension.

Gameplay requires no transaction signature per move. The server signs and pays bounded Rabdi test-token fees. A remote demo needs the Node/WebSocket backend; static hosting alone is insufficient. The [theme screenshot](../docs/screenshots/swarm-gameplay.png) and [Diwali preview](../docs/screenshots/diwali-home.png) show the implemented interface.

## Evidence and current limits

- Thirteen campaign migration seeds are included in source. This is a content count, not a claim that thirteen levels are currently live; short-lived publications can expire.
- Two selectable theme packs, Modern Gray and Diwali, have recorded Swarm releases and current 1.1.0 Arkiv pointers. See [live references](swarm.md).
- The Rabdi theme query returned four publications during the **2026-11-07 UTC** audit: two historical 1.0.0 records and two current 1.1.0 records. These are publication counts, not player counts.
- We have no documented independent-player, retention, active-user, or external-adoption measurements yet. The two shared development accounts are not traction evidence.
- The prototype uses one application server. The configured ceiling of 200 sessions is a code limit, not a load-tested concurrency result.

## After Mumbai

We want to add more levels, run playtests with people outside the team, and improve the game using their feedback. Continued development will depend on player interest. First priorities are publishing the public play URL, testing whether players understand the two timelines and replay selection, and learning whether creators want to publish more chambers.

We would then improve the creator and replay-discovery flows and define a sustainable renewal policy for campaign content. The two-hour base lifetime and community hearts make retention visible, but do not promise that every level stays available forever. We are not claiming a funded roadmap or ongoing production service.
