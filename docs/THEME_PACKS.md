# Theme packs

Gameplay, the title chamber, editor objects and palette, avatars, wallet and status icons resolve semantic sprite IDs through `src/assets/catalog.ts`. Phaser and DOM adapters read the same source rectangles. Game rules, level solutions, authentication and network messages do not depend on artwork paths.

## Pack contract

- Use a versioned, data-only `manifest.json`: schema version, stable pack ID, semantic version, palette, sheet hashes/dimensions, frame rectangles, render size/pivots and animation definitions. PNG paths are relative `sheets/*.png`; no scripts, HTML or arbitrary remote URLs.
- Preserve semantic IDs such as `crate.p1`, `switch.p2.held`, `exit.p1.open`, `player.p1.walk.north` and `fx.weld`. Replace art by changing data, rather than branching renderer code by theme name.
- Provide all four character facings and eight actions. Keep frame sizes and pivots stable within an animation; use the same footprint/anchor convention across packs. P1 has one facial eye; P2 has two. Chest identity bars are optional; the Diwali costumes have no identity lettering or bars. Colours and silhouettes must distinguish ownership at gameplay size.
- Current direction: orthogonal top-down grid with visible height, modern pixel detail, light-gray neutral objects, burgundy P1 and teal P2. Use nearest-neighbour filtering. Avoid unnecessary rounding, bevels, labels and ruin decoration.
- Keep original approved PNG bytes intact. Atlases may have different dimensions and cell grids; declare exact integer rectangles instead of assuming a universal tile size. Effect cells retain their motion margins. Use render metrics to adjust scale, not runtime image regeneration.
- World objects sort by their ground position from back to front. Foreground walls occlude rear switches, crates and operators; same-cell layers only break ties. Floors/replay overlays remain below solid objects. Character image offsets and sprite heights must not affect sorting; moving objects update depth during their tween. Gameplay and the title chamber share `src/render/depth.ts`.
- Themes may change presentation, never mechanics or hidden information. New game sessions wait for theme loading and registration before joining. The Other perspective switch shows the opposite starting role using the same pack and role-specific renderer. Show the weld pulse only after confirmed success. No weld target previews in player views. Author view may display targets explicitly. Box identity labels default off.
- The study view contains one role at a time, using normal full-size objects and layering. There is no timed combined overlay or overlap cycling. The switch stays available until that operator’s first valid selection, then returns to the own-role view. Never render live opposite-role positions or histories through this switch.
- Missing required artwork is an error. Do not silently generate substitute sprites or fall back to local copies after a remote load fails.

## Add a pack

1. Add `public/themes/<id>/manifest.json` and its declared PNGs, with an identical manifest under `src/assets/<id>.json` for bundling. Vite serves public files verbatim and rejects module imports from that directory during development. Follow `src/assets/schema.ts`; use the current manifest as the complete semantic inventory. Validate the two manifest copies remain byte-identical.
2. Validate every sheet's byte count, SHA-256 and PNG dimensions. Keep version numbers immutable after publication.
3. Keep an identical bundled bootstrap manifest in `src/assets/<id>.manifest.json` and a separate deployment JSON. Add one entry to `src/assets/sources.ts` with the manifest, deployment, output paths and any legacy aliases. The catalog, editor, API and publication tools use this registry. Keep legacy `foundry`/`orbital` aliases so archived levels remain compatible.
4. Upload the exact assets and verify every file through a public read gateway. A small immutable release index maps the source manifest and each sheet to their Swarm collection references; PNG groups stay below 8 MB. Pass `-- --theme <id>` to the public upload/verify and Arkiv publication commands; the default remains `modern-gray`. Publish the index reference and hashes in a trusted Arkiv theme entity.
5. Check title, gameplay, editor and DOM icons at desktop/mobile sizes, four facings, switch/exit/laser states, terminal effects and hidden-state boundaries. Run `npm test` and `npm run build`.

No core engine or screen edits should be necessary for a complete pack. New gameplay object types require a deliberate schema/renderer extension shared by every pack.

## Current pack and publication

`npm run assets:prepare` writes identical public and bundled bootstrap manifests and reproducibly copies the 29 selected original PNGs from the sibling `output/` art folders and builds the modern-gray manifest. Rejected exploration images are excluded. It currently defines 556 sprite frames and 74 animations.

`npm run assets:public:check` validates the original PNG allowlist and bounded upload plan without network writes. `npm run assets:upload:public` uploads the source manifest, groups of original PNGs, then a release index. New uploads use `https://bzz.limo` unless `SWARM_PUBLIC_GATEWAY_URL` overrides it. A resumed journal preserves its original upload service. `SWARM_GATEWAY_URL` chooses the public read endpoint. Public mode never sends an upload token, queries private postage endpoints or purchases a batch.

`npm run assets:verify:public` resumes readback without uploading again. All hashes must match before the script updates that pack’s registered deployment JSON. An uncertain POST outcome blocks resubmission; reconcile its saved journal first. The uploader preserves an existing Arkiv proof only when the release and manifest hashes still match. It never invents a batch ID or retention guarantee for subsidised uploads.

The published release index supplies each sheet reference. The browser first reads `/api/themes/<id>`; the server reads the pinned, readonly Arkiv entity through the existing archive and verifies its publisher/routing against deployment pins. The browser fetches the release and source manifest from Swarm, verifies both SHA-256 hashes, validates the semantic contract, and uses the declared sheet references in both Phaser and DOM adapters. Network failure is shown as unavailable artwork, never a silent local fallback or a claim that content expired.

To publish a new theme version, finish Swarm verification, stop the running server to release the single signer, run `npm run arkiv:theme:quote`, then `npm run arkiv:theme:publish` within configured budgets. Restart/rebuild. Theme pointers use a separate public Arkiv schema; level layouts and solutions retain the encrypted schema. Theme and level writes share one durable pre-send journal, signer lock, nonce checks and fee budget. Lost replies reconcile the original transaction without automatically resending.

The owned-Bee commands (`assets:upload`, `assets:verify`) remain a backup requiring `SWARM_BEE_URL` and `SWARM_POSTAGE_BATCH_ID`, plus an optional private token. Those settings must never appear in a public pack. Keep `.env*`, `.data/`, accounts, source and private solutions out of collections.

The root HTML `data-asset-source` reports `swarm` for the verified deployed pack. Public read endpoints must allow browser CORS. Keep original files available for republishing and confirm operator-funded retention before relying on it beyond the demo. Content references remain independent of read gateway choice.

## Diwali pack

`diwali` 1.1.0 provides both players’ complete eight-action, four-facing animation sets, festive exit states and matching kurta avatars. P1 wears burgundy with gold trim; P2 retains the green helmet and two eyes but wears a dark navy kurta. Neither costume uses chest identity bars. Exits carry warm lights and marigold trim. Neutral gameplay objects retain the approved Modern Gray art, and every semantic sprite/animation ID is preserved.

Choose **Diwali** with the home settings theme control or the gameplay environment button. The choice persists across reloads and chamber entry; editor levels retain their own authored environment. Use the editor’s environment selector to author a Diwali level.

`npm run assets:prepare:diwali` rebuilds both manifests without changing PNG pixels. Selected originals are in `public/themes/diwali/sheets/`; prompt history and measured frame bounds are in `output/diwali/`. Private generation drafts are excluded from Git and uploads. Publication commands:

```sh
npm run assets:public:check -- --theme diwali
npm run assets:upload:public -- --theme diwali
npm run assets:verify:public -- --theme diwali
npm run arkiv:theme:quote -- --theme diwali
npm run arkiv:theme:publish -- --theme diwali
```

The Diwali deployment and verification evidence are separate from Modern Gray, so adding or publishing it cannot overwrite the original pack’s pins.

## Crate and plate refresh — 1.1.0

Both packs use the approved X-braced shipping crates and recessed floor plates from `public/art-reviews/crate-pressure-v1/`. `scripts/lib/object-art.mjs` applies the same source PNGs, crop rectangles and render metrics during preparation. The plate spans 0.98 tiles; the crate spans 0.80 tiles and anchors its front edge 0.35 tiles below the ground center, leaving the plate rim exposed. All six plate states share a canvas and pivot. Ground-based depth sorting remains unchanged. Mirrors and every other gameplay sprite retain their earlier art.

The original 1.0.0 manifests, deployment pins and verification records are archived under `docs/themes/history/<id>/1.0.0/`. Swarm upload journals now include the pack version, preserving earlier release records and uncertain-write protection. New releases never replace files at an old content reference.
