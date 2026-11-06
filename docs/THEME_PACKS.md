# Theme packs

Gameplay, the title chamber, editor objects and palette, avatars, wallet and status icons resolve semantic sprite IDs through `src/assets/catalog.ts`. Phaser and DOM adapters read the same source rectangles. Game rules, level solutions, authentication and network messages do not depend on artwork paths.

## Pack contract

- Use a versioned, data-only `manifest.json`: schema version, stable pack ID, semantic version, palette, sheet hashes/dimensions, frame rectangles, render size/pivots and animation definitions. PNG paths are relative `sheets/*.png`; no scripts, HTML or arbitrary remote URLs.
- Preserve semantic IDs such as `crate.p1`, `switch.p2.held`, `exit.p1.open`, `player.p1.walk.north` and `fx.weld`. Replace art by changing data, rather than branching renderer code by theme name.
- Provide all four character facings and eight actions. Keep frame sizes and pivots stable within an animation; use the same footprint/anchor convention across packs. P1 has one eye/chest bar; P2 has two. Colours and silhouettes must distinguish ownership at gameplay size.
- Current direction: orthogonal top-down grid with visible height, modern pixel detail, light-gray neutral objects, burgundy P1 and teal P2. Use nearest-neighbour filtering. Avoid unnecessary rounding, bevels, labels and ruin decoration.
- Keep original approved PNG bytes intact. Atlases may have different dimensions and cell grids; declare exact integer rectangles instead of assuming a universal tile size. Effect cells retain their motion margins. Use render metrics to adjust scale, not runtime image regeneration.
- Themes may change presentation, never mechanics or hidden information. Show the weld pulse only after confirmed success. No weld target previews in player views. Author view may display targets explicitly. Box identity labels default off.
- Missing required artwork is an error. Do not silently generate substitute sprites or fall back to local copies after a remote load fails.

## Add a pack

1. Add `public/themes/<id>/manifest.json` and its declared PNGs. Follow `src/assets/schema.ts`; use the current manifest as the complete semantic inventory.
2. Validate every sheet's byte count, SHA-256 and PNG dimensions. Keep version numbers immutable after publication.
3. Add one `makePack(manifest, deployment)` entry in `src/assets/catalog.ts`, include it in `registeredThemes`, and map its ID in `environments`. Each pack has its own deployment reference. Keep legacy `foundry`/`orbital` aliases so archived levels remain compatible.
4. Serve the pack from its local theme directory. Keep each version immutable; a deployment descriptor can later select an immutable remote collection.
5. Check title, gameplay, editor and DOM icons at desktop/mobile sizes, four facings, switch/exit/laser states, terminal effects and hidden-state boundaries. Run `npm test` and `npm run build`.

No core engine or screen edits should be necessary for a complete pack. New gameplay object types require a deliberate schema/renderer extension shared by every pack.

## Current pack and publication

`npm run assets:prepare` reproducibly copies the 28 selected original PNGs from the sibling `output/` art folders and builds the modern-gray manifest. Rejected exploration images are excluded. It currently defines 556 sprite frames and 74 animations.
