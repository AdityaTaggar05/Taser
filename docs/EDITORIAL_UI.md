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
