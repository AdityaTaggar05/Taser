# WeldPoint editorial UI

The interface uses warm paper, graphite rules, serif headlines, monospaced metadata, teal and vermilion accents. Existing sprites and Swarm theme loading remain in use.

## Flow

- Landing → wallet / Atlas / Nova onboarding → play or create → players, collection and role for play.
- The archive supports title/creator search, newest, popular and estimated-expiry sorting. The right-hand options select the role and launch the chosen chamber. Solo retains creator/player replay selection; co-op retains invite codes and the two-player Ready handshake.
- Profile settings are available across authenticated screens: sound, theme pack, fullscreen and account switching. Switching wallets signs out first; it does not merge accounts.
- The shared animated guide is available from setup and gameplay, with reduced-motion support.
- Desktop gameplay has a chamber, box-position history, Arkiv activity preview with filter presets, and a paired-move card stack. Small screens expose the inspectors on demand.

## Evidence and boundaries

Box snapshots use only the current player's server-projected history. Move cards continue to query the existing authenticated move API. Arkiv presets filter the account activity response; they are not arbitrary SQL queries. Confirmed entity and transaction links remain available in live archive mode. Test data is labelled TEST. Expiry is a block-time estimate; zero means check expiration, not proof of deletion.

## Verification

Browser checks used `scripts/browser/block-explorer.fixture.ts`, an isolated in-memory archive, without a signer or blockchain writes. Checked landing, Atlas and Nova login, mode/objective selection, archive search and sorting, role cycling, solo play, stationary shove snapshots, confirmed move cards, history review/return to live, animated guide, profile sound, 390px gameplay and inspectors, creator entry, and two-tab co-op invite/Ready/start/paired movement. Wallet signing and live Arkiv writes were not exercised in this UI pass.

Build and Vitest checks accompany the change. Existing standalone browser scripts target the previous navigation and need their selectors adapted before reuse; the checks above were performed interactively against the production build.

## Short demo route

Show the title, choose an operator and mode, select a chamber, then commit a move. Point to the box snapshot and P1/P2 pair. In a configured live environment, show the confirmed entity/transaction link in Arkiv. Briefly open the reverse-history guide. Use the profile to demonstrate a theme change if time permits.

## Creator publication workflow

The editor includes master's publication overlay, with a horizontal step row at the bottom, centered stage-specific diagrams, wide sliding/fading scene transitions, and a 2.5-second freeze presentation dwell. The overlay uses the same paper, graphite, serif headings, monospaced metadata, teal controls and vermilion errors as the rest of this branch. The dwell does not delay the server request or create verification evidence. A proof-bound check appears only after verified server approval; the published-level action still requires confirmed Arkiv publication. Reduced-motion and narrow-screen behavior remain supported.

Publication UI checks used the isolated component fixture with the real application stylesheet stack: freeze dwell, verified check, published action, rejected/error states, and desktop/390px layout. The fixture uses synthetic evidence only and performs no CRE execution or Arkiv write.

Playtest retains the editorial shell and paper canvas backdrop. Board artwork still uses the selected environment. Editor dialogs and the submission-status controls explicitly accept pointer input while the playtest shell passes board input through. Regression checks exercise publishing during active playtest, opening the share dialog, and launching its role-selection action with a mocked archive.
