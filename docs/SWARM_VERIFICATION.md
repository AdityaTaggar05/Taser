# Live theme verification — 2026-11-06

- Uploaded 28 original approved PNGs, the semantic manifest and a release index through the Swarm Foundation public gateway. Exact byte counts and SHA-256 values matched on public readback.
- Independently verified every file through the booth-recommended `https://bzz.limo` endpoint; response headers permit browser CORS.
- Published and read back the readonly Arkiv Rabdi theme entity. Receipt and canonical transaction checks use the existing durable writer journal and test-token fee budgets.
- The running `/api/themes/modern-gray` endpoint returns the actual pinned entity's Swarm reference and hashes.
- Browser startup reads that endpoint, then the Swarm release/manifest. Login, role selection and the gameplay board render successfully. The HTML reports `data-asset-source="swarm"`; DOM inspection found 72 remote sprite instances, zero local sprite URLs and zero artwork warnings. Browser error logs were empty.
- Foreground wall occlusion remains correct in the gameplay screenshot.
- Production build passed. All 124 tests passed, including upload boundaries, public-mode credential isolation, metadata tampering, publisher/routing checks, unknown-transaction reconciliation, fee limits and level-category query isolation.
- During restart, unrelated encrypted `run` records in the existing level schema/namespace exposed an overly broad catalog query. It now filters actual level categories before hydration while retaining strict validation of returned levels. No remote run records were changed.
- Source PNG bytes remain unchanged. The bundled bootstrap manifest and uploaded source manifest match; the preparation script generates both copies to support Vite development and production builds.

Live references and reproducible commands: [Arkiv + Swarm evidence](../arkiv/swarm.md). Per-file hashes: [release evidence](theme-release.json). Screenshot: [Swarm gameplay](screenshots/swarm-gameplay.png).

Remaining submission information: operator-supplied postage batch ID and attribution, confirmed retention/service limits, and the demo-video timestamp. These are not inferred from the content reference. Taser is verified locally; this check does not claim that its multiplayer backend has been deployed to an external host.

## Diwali release

The Diwali 1.0.0 release contains 28 PNGs, a manifest and a release index, all verified by exact public readback through `bzz.limo`. Its separate readonly Arkiv publication was submitted within the configured test-token budget and verified on readback. `/api/themes/diwali` returns the matching published reference and hashes. [Per-file hashes and publication proof](themes/diwali-release.json).

The browser rendered both kurta-clad operators and decorated exits on the home chamber. Its active theme is `diwali`, asset source is `swarm`, artwork warnings are zero, and there are no local DOM sprite URLs. [Diwali home preview](screenshots/diwali-home.png). All 384 player animation cells passed nonempty/cell-clipping inspection. All 125 tests and the final production build passed. No original Modern Gray PNGs were changed.

## Crate and pressure plate release — 1.1.0

The user approved publication of the local sprite study. Modern Gray and Diwali each now contain 29 PNGs; every PNG, manifest and release index passed exact public readback through `bzz.limo`. Both new readonly Arkiv theme pointers were verified on readback using the configured test-token budgets. The three standard crates and eighteen pressure-plate frames use the approved original PNG bytes, with wider plates, raised crate pivots and stable pressure-state canvases. All other semantic sprites and all 74 animations are unchanged. The 1.0.0 publication records and content references are preserved in `themes/history/`. All 126 tests pass.

[Object refresh references and direct asset URLs](../public/art-reviews/crate-pressure-v1/publication.json).
