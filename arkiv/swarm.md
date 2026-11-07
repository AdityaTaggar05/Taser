# Arkiv + Swarm integration evidence

WeldPoint stores public artwork on Swarm and publishes its release references on Arkiv. The selectable **Modern Gray** and **Diwali** packs both use version **1.1.0**, with 29 PNGs, a semantic manifest, and a release index per pack. Gameplay, home artwork, avatars, status icons, and editor sprites use these assets.

## Current publication evidence

Both packs use **Rabdi, chain ID 7794095**, with publisher wallet **`0xaC4d639d5C2CAD6D8c1d9d3cd1470467324764Ca`**.

| Evidence | Modern Gray 1.1.0 | Diwali 1.1.0 |
| --- | --- | --- |
| Arkiv entity key | [`0xa96d9463f43648df11ac8a002bfcffcf791a8dd00e2efd7e4f68d490f3565ca9`](https://rabdi.explorer.arkiv.network/entity/0xa96d9463f43648df11ac8a002bfcffcf791a8dd00e2efd7e4f68d490f3565ca9) | [`0xf970549a14bc3f6f509e4dcf2e48505d28d9f93cec92a59d4d29933afb7a826f`](https://rabdi.explorer.arkiv.network/entity/0xf970549a14bc3f6f509e4dcf2e48505d28d9f93cec92a59d4d29933afb7a826f) |
| Publication transaction | [Receipt](https://rabdi.explorer.arkiv.network/tx/0xa262113a4f90d665ae0004ff5b37176ed7dd2f411ecc1857b861c1a16146ff70) | [Receipt](https://rabdi.explorer.arkiv.network/tx/0xff7d214ad5f52287116b674dc58442fce6a7523dd5d0a4d5c524e1783223984e) |
| `swarm_reference` | `948e9c1809ead2e8784a706a1d533e0b5ca8c3d4086a2eb635598582e9e86e72` | `d3764188ca5a7c4f29fb0b95816f2f8cb2d6f4b48194e1f3206a48f65358acdf` |
| Open the release | [release.json](https://bzz.limo/bzz/948e9c1809ead2e8784a706a1d533e0b5ca8c3d4086a2eb635598582e9e86e72/release.json) | [release.json](https://bzz.limo/bzz/d3764188ca5a7c4f29fb0b95816f2f8cb2d6f4b48194e1f3206a48f65358acdf/release.json) |
| Open the source manifest | [manifest.json](https://bzz.limo/bzz/01955cb7732b36cd9a5e50ade147ea7f41fa6d740b0ee3d4d1b591bef60ac5b0/manifest.json) | [manifest.json](https://bzz.limo/bzz/09fb587d8be79881791ad32c0d9121236905cd09acbd5ae94260a36f454e77d2/manifest.json) |
| Recorded expiration block | `8178665` | `8178700` |
| Full release evidence | [Hashes, sizes, references, and upload metadata](../docs/theme-release.json) | [Hashes, sizes, references, and upload metadata](../docs/themes/diwali-release.json) |

The 1.1.0 evidence records `https://bzz.limo` as both upload service and read gateway, and **Swarm Foundation public gateway** as postage supplier. The earlier 1.0.0 Modern Gray upload used `https://api.gateway.ethswarm.org`; [historical releases](../docs/themes/history/) retain those references.

On **2026-11-07 UTC**, a read-only Rabdi query returned both current entities with matching references and readonly flags. This audit also fetched both releases/manifests through `bzz.limo`, matched their recorded SHA-256 hashes, and checked the size/hash of `sheets/p1-idle.png` from each pack. Earlier complete per-file verification is recorded in [the release notes](../docs/SWARM_VERIFICATION.md) and evidence JSON. No upload or Arkiv write was performed during this documentation audit.

## Storage split and visible feature

Swarm holds public PNGs, the source semantic manifest, and a release index per pack. PNG collections remain under 8 MB each. The index maps sheets to collection references and paths. Source code, credentials, databases, and private puzzle solutions are excluded from uploads.

Arkiv holds public `taser_themes_v1` entities. The **`swarm_reference`** field points to the release index; `theme_id`, `version`, `manifest_sha256`, and `release_sha256` describe the release. Level layouts and solutions remain in the separate encrypted Arkiv archive.

On startup the browser requests `/api/themes/modern-gray` and `/api/themes/diwali`. The server reads the pinned entity, validates publisher/flags/routing, and returns the public pointer. The browser verifies the Swarm release/manifest hashes and schema, then resolves sprites through the declared collections. The upload verifier checks every uploaded file's size/hash; runtime validates metadata and uses the resulting content-addressed sprite references.

Current fallback behavior matters for the demo: remote metadata or artwork failure triggers a bundled Modern Gray fallback after the configured eight-second stage timeout. Settings identify it as **Local**, and `document.documentElement.dataset.assetSource` becomes `local`. A successful Swarm demo must show `swarm` and actual remote image requests. Fallback artwork does not establish a successful remote read and never replaces unavailable game-level data.

## Run an upload and a read

Use Node.js 22.13+, installed dependencies, the checked-in public theme files, and gateway access. Public upload uses gateway-supplied postage; it does not buy a batch or require a private Bee token. Gateway availability and acceptance limits remain external dependencies.

From the repository root:

```sh
# Validate the allowlist and bounded plan without network writes.
npm run assets:public:check -- --theme modern-gray

# Upload the frozen pack and verify every file through public readback.
npm run assets:upload:public -- --theme modern-gray

# Repeat readback using the local upload journal, without a new upload.
npm run assets:verify:public -- --theme modern-gray
```

Expect collection references and per-file verification messages, followed by a deployment update. The ignored `.data/swarm-public-<theme>-<version>.json` journal supports resuming an accepted upload; unchanged confirmed parts are reused. An unknown previous POST outcome blocks automatic resubmission. Do not delete the journal to force another upload. Substitute `--theme diwali` for the other pack. `SWARM_PUBLIC_GATEWAY_URL` overrides the upload service; `SWARM_GATEWAY_URL` selects the read gateway.

A fresh checkout can read the existing release without that private journal:

```sh
curl --fail --silent --show-error 'https://bzz.limo/bzz/948e9c1809ead2e8784a706a1d533e0b5ca8c3d4086a2eb635598582e9e86e72/release.json'
```

Expect JSON with `kind: "taser-theme-release"`, `id: "modern-gray"`, `version: "1.1.0"`, a manifest reference, and sheet mappings. Follow those references to read the actual artwork.

To publish an uploaded pack's Arkiv pointer, configure server-only Arkiv keys/access key and approved tGLM budgets, then stop the server to release its exclusive signer:

```sh
npm run arkiv:theme:quote -- --theme modern-gray
npm run arkiv:theme:publish -- --theme modern-gray
```

The quote is unsigned. Publication uses the durable journal, confirms the receipt, and verifies readback; an unchanged release reuses existing evidence. Run `npm run dev`, open `/api/themes/modern-gray`, and inspect the browser's `bzz.limo/bzz/...` requests and `data-asset-source="swarm"`. See [setup](../README.md#run-and-connect) and [theme-pack guidelines](../docs/THEME_PACKS.md).

## Implementation files

| Responsibility | Files |
| --- | --- |
| Upload planning, splitting, journal, and exact readback | [swarm-public-assets.ts](../scripts/swarm-public-assets.ts), [public-theme.ts](../scripts/lib/public-theme.ts), [swarm-theme.ts](../scripts/lib/swarm-theme.ts) |
| Optional owned-Bee upload path | [swarm-assets.ts](../scripts/swarm-assets.ts) |
| Arkiv pointer publication/validation | [arkiv-theme.ts](../scripts/arkiv-theme.ts), [ThemePublication.ts](../server/arkiv/ThemePublication.ts), [ArkivArchive.ts](../server/arkiv/ArkivArchive.ts) |
| Server pointer reads | [ThemeApi.ts](../server/assets/ThemeApi.ts) |
| Browser metadata reads, sprite URLs, and fallback | [remote.ts](../src/assets/remote.ts), [schema.ts](../src/assets/schema.ts), [catalog.ts](../src/assets/catalog.ts), [ArtworkLoader.ts](../src/assets/ArtworkLoader.ts) |
| Registry and current deployment references | [sources.ts](../src/assets/sources.ts), [Modern Gray](../src/assets/deployment.json), [Diwali](../src/assets/diwali.deployment.json) |

## Swarm friction

The owned-Bee workflow assumes a known postage batch and private postage endpoints. A subsidised gateway needed a separate upload path. The public UI's stated 10 MB limit led us to split artwork into collections under 8 MB and publish a release index. We preserved original PNG bytes and used bounded concurrency for remote reads. Slow gateway responses also motivated loading progress, timeouts, and the labeled local fallback.

Public gateway responses did not give us the postage batch ID or funding-wallet attribution recorded by an owned-Bee workflow. A metadata endpoint exposing supplied batch, provider, and retention policy would make integration evidence easier to collect.

## Remaining submission details

- **Postage batch ID:** awaiting the gateway operator; not inferred from a content hash. Both release evidence files currently record `postageBatchId: null`.
- **Postage supplier/funder:** the recorded supplier is Swarm Foundation public gateway; confirm the batch attribution and who supplied it or which wallet funded it with the operator.
- **Retention/service limits:** awaiting the operator; no permanent-storage guarantee is claimed.
- **Demo video and timestamp:** not supplied. Record opening a theme, show the Arkiv pointer response and Swarm asset requests, and capture `data-asset-source="swarm"`; insert the exact video timestamp here.

Only public, unencrypted Swarm references are published in Arkiv. Puzzle solutions stay in the separate encrypted Arkiv archive. An encrypted Swarm reference includes its key and must not be published as plaintext; this integration does not use encrypted Swarm references. [Prize requirements](https://ethglobal.com/events/mumbai/prizes/arkiv).
