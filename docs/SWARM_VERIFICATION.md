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
