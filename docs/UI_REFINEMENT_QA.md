# UI refinement verification

The refinement keeps one light interface palette and the existing chamber artwork packs.

| Request | Implementation and evidence |
| --- | --- |
| Reduce descriptions | Removed menu option explanations and archive intros; shortened creator and Arkiv copy. Rule explanations, errors and archive-state labels remain. |
| Hover visibility | Verified the hovered Ethereum button has cream text (`rgb(243,239,229)`) on teal (`rgb(66,110,104)`), including its child text. |
| Objective first | Browser login opens 01 / Choose your objective. Play opens 02 / Configure your timeline. Create opens the editor directly. Removed the old Enter shortcut that skipped setup. |
| Profile proportions | Sprites use each manifest frame's width/height ratio. Browser measurement: 76px × 110.078px for ratio 0.690376569. Header avatar fits its 60px control. |
| Micro animations | Selected menu controls animate; buttons depress; option labels transition in; sound uses a moving switch knob (verified 180ms and a 14px translation). Reduced motion disables animation. |
| Icon sizing / vectors | Back, help and fullscreen use 24px SVGs. Sprite controls preserve their source aspect ratio. |
| Archive | Campaign has no expiry column or expiry sort; community has both. Campaign leaderboard expiry is hidden, verified in browser. Likes have 44px targets. Native select has a matching light treatment and SVG chevron. Clicking the creator cell selected the entire row and Start launched P2. Forward/Reverse labels have no attached arrows. |
| Back navigation | Onboarding, objective, configuration, archive, replay choices, leaderboard, lobby, gameplay and creator have return controls. Dialogs have close/previous controls; the entry screen uses browser Back when history exists. |
| Time / box history | Played the first campaign as P2 from 08/08 through a win at 00/08. Box snapshots ran T08 through T00. P1 retains the increasing clock. Snapshot coordinates and reference-route controls were removed. |
| Readability | Main controls and body text increased to 14–23px, metadata generally 12px. Checked desktop and 390px gameplay, settings, archive, leaderboard and creator. |
| Light interface | Inspected login, setup, archive, replay, game, profile, leaderboard, creator and creator-library surfaces. Removed the ambiguous half-circle theme utility; artwork packs remain in Profile. |
| Alignment | Utility SVGs share a 24px viewbox; sprite ratios come from the manifest; profile control has room for the avatar; creator/sidebar and mobile controls were visually checked. |

Validation used the isolated test archive fixture, not live blockchain writes. Build and all 208 Vitest tests passed. UI navigation, hover, clock, layout and sprite checks were performed interactively in the browser; the older standalone browser scripts still target the previous navigation.
