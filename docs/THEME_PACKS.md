# Theme packs

Gameplay, the title chamber, editor objects and palette, avatars, wallet and status icons resolve semantic sprite IDs through `src/assets/catalog.ts`. Phaser and DOM adapters read the same source rectangles. Game rules, level solutions, authentication and network messages do not depend on artwork paths.

## Pack contract

- Use a versioned, data-only `manifest.json`: schema version, stable pack ID, semantic version, palette, sheet hashes/dimensions, frame rectangles, render size/pivots and animation definitions. PNG paths are relative `sheets/*.png`; no scripts, HTML or arbitrary remote URLs.
- Preserve semantic IDs such as `crate.p1`, `switch.p2.held`, `exit.p1.open`, `player.p1.walk.north` and `fx.weld`. Replace art by changing data, rather than branching renderer code by theme name.
- Provide all four character facings and eight actions. Keep frame sizes and pivots stable within an animation; use the same footprint/anchor convention across packs. P1 has one eye/chest bar; P2 has two. Colours and silhouettes must distinguish ownership at gameplay size.
- Current direction: orthogonal top-down grid with visible height, modern pixel detail, light-gray neutral objects, burgundy P1 and teal P2. Use nearest-neighbour filtering. Avoid unnecessary rounding, bevels, labels and ruin decoration.
- Keep original approved PNG bytes intact. Atlases may have different dimensions and cell grids; declare exact integer rectangles instead of assuming a universal tile size. Effect cells retain their motion margins. Use render metrics to adjust scale, not runtime image regeneration.
- World objects sort by their ground position from back to front. Foreground walls occlude rear switches, crates and operators; same-cell layers only break ties. Floors/replay overlays remain below solid objects. Character image offsets and sprite heights must not affect sorting; moving objects update depth during their tween. Gameplay and the title chamber share `src/render/depth.ts`.
- Themes may change presentation, never mechanics or hidden information. New game sessions wait for theme loading and registration before joining, so the ten-second combined initial preview cannot begin behind an unloaded canvas. Show the weld pulse only after confirmed success. No weld target previews in player views. Author view may display targets explicitly. Box identity labels default off.
- Missing required artwork is an error. Do not silently generate substitute sprites or fall back to local copies after a remote load fails.

## Add a pack

1. Add `public/themes/<id>/manifest.json` and its declared PNGs, with an identical manifest under `src/assets/<id>.json` for bundling. Vite serves public files verbatim and rejects module imports from that directory during development. Follow `src/assets/schema.ts`; use the current manifest as the complete semantic inventory. Validate the two manifest copies remain byte-identical.
2. Validate every sheet's byte count, SHA-256 and PNG dimensions. Keep version numbers immutable after publication.
3. Add one `makePack(manifest, deployment)` entry in `src/assets/catalog.ts`, include it in `registeredThemes`, and map its ID in `environments`. Each pack has its own deployment reference. Keep legacy `foundry`/`orbital` aliases so archived levels remain compatible.
4. Upload the exact pack collection and verify every file through a public read gateway. The manifest and atlas paths under one immutable Swarm reference form the release. Configure the upload CLI for that pack; its current default is `modern-gray`.
5. Check title, gameplay, editor and DOM icons at desktop/mobile sizes, four facings, switch/exit/laser states, terminal effects and hidden-state boundaries. Run `npm test` and `npm run build`.

No core engine or screen edits should be necessary for a complete pack. New gameplay object types require a deliberate schema/renderer extension shared by every pack.

## Current pack and publication

`npm run assets:prepare` reproducibly copies the 28 selected original PNGs from the sibling `output/` art folders and builds identical public and bundled modern-gray manifests. Rejected exploration images are excluded. It currently defines 556 sprite frames and 74 animations.

`npm run assets:check` validates local files without network writes. Configure `SWARM_BEE_URL`, `SWARM_POSTAGE_BATCH_ID`, optional `SWARM_AUTH_TOKEN` and public `SWARM_GATEWAY_URL` in ignored `.env.local`. The Bee service must expose the postage lookup and collection upload APIs; a read-only gateway is insufficient.

`npm run assets:upload` checks existing postage usability, uploads only manifest + declared PNGs as a collection, journals the returned reference, downloads and hashes every public file, then updates `src/assets/deployment.json`. It does not buy postage. `npm run assets:verify` resumes readback without uploading again. An unknown POST outcome requires operator reconciliation; automatic duplicate submission is disabled.

The deployment's reference is currently null: artwork is served locally. Once verified, rebuilding the app routes every registered sprite URL through the configured `/bzz/<reference>/...` root. The root HTML `data-asset-source` reports `local` or `swarm`. CORS must permit browser images. Public readback never receives the upload token. Keep `.env*`, `.data/`, accounts, source and private solutions out of asset collections.

Maintain postage availability for the intended demo lifetime. Gateway HTTP failures mean unavailable/unknown content, not proof of expiry. Changing a read gateway does not change the content reference.
