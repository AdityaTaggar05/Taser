# Arkiv + Swarm integration evidence

The modern-gray theme is live on Swarm and linked from a verified readonly Arkiv Rabdi entity. Gameplay, home artwork, avatars, status icons and editor sprites use this pack.

## Live references

- Arkiv entity: [0x39a6f9a494b3d8f48355b53c8cf45b9892f5ba17dcac63089a12358c9ebdace9](https://rabdi.explorer.arkiv.network/entity/0x39a6f9a494b3d8f48355b53c8cf45b9892f5ba17dcac63089a12358c9ebdace9).
- Publisher wallet: `0xaC4d639d5C2CAD6D8c1d9d3cd1470467324764Ca`.
- Transaction: `0xfbef96480ab93717cd100c66bcd4bab61b8bfdf408ab0ec3d01d13e36041174a`.
- Entity expiry block: `8170159`; the SDK maximum expiration was requested. Availability is rechecked on reads.
- Swarm release index: [release.json](https://bzz.limo/bzz/ea2b39ea4e686a1059b530e3fe06a5f3b8a11ab35af2941b81820c7cf900ef8e/release.json).
- Original source manifest: [manifest.json](https://bzz.limo/bzz/17b5663b9dc1a9b27de9a09a6184f8a266b67d284b060c53ccd2373e0eddc4fe/manifest.json).
- Release SHA-256: `8f7b277aa8bdd5808c3f12cdd768871a2bc28552c1208ed7461261f8548145ff`.
- Manifest SHA-256: `84509196f50524bbe12492bf2f30afc0004c16d99295718f206d9751daabd914`.
- Upload service: `https://api.gateway.ethswarm.org` (Swarm Foundation public gateway).
- Booth-recommended read gateway, with full byte verification: `https://bzz.limo`.
- Verification time: `2026-11-06T09:36:34.550Z`.

## Storage split and feature

Swarm holds all 28 approved original PNGs, the source semantic manifest and a small release index. Six PNG collections remain under 8 MB each; no source, credentials, databases or private game solutions are uploaded. The index maps each sheet to its collection reference and path. Hashes and per-file sizes are in [the release evidence](../docs/theme-release.json).

Arkiv holds a separate public `taser_themes_v1` entity. Its `swarm_reference` field points to the release index, with `theme_id`, `version`, `manifest_sha256` and `release_sha256` fields. Level layouts and solutions remain in the separate encrypted level archive.

On startup the browser requests `/api/themes/modern-gray`. The server reads the pinned Arkiv entity, validates the publisher, immutable flags and routing, and returns the public pointer. The browser fetches the Swarm release and source manifest, verifies both hashes and schema, then loads every sprite through the declared Swarm references. Failed reads show unavailable artwork; they do not silently select local sprites or assert expiry.

## Reproduce

1. Install dependencies and configure the existing server-only Arkiv environment; preserve the private journal and keys.
2. `npm run assets:public:check` checks the original PNG allowlist and bounded plan without writes.
3. `npm run assets:upload:public` performs one subsidised upload workflow. New uploads default to `https://bzz.limo`; resumed journals preserve their original service. `SWARM_PUBLIC_GATEWAY_URL` overrides the upload service, and `SWARM_GATEWAY_URL` selects a read endpoint. No batch purchase or private upload token is required in public mode.
4. `npm run assets:verify:public` repeats exact readback with no new upload. Keep the ignored journal to resume safely; unknown POST outcomes block duplicate submission.
5. Stop the running app to release its single signer. `npm run arkiv:theme:quote` estimates the public pointer write; `npm run arkiv:theme:publish` uses the existing durable journal and configured test-token fee limits, confirms the receipt and checks readback. An unchanged release reconciles its original transaction rather than sending another.
6. `npm run build`, then run the app. Open `/api/themes/modern-gray` to see the live Arkiv pointer and inspect image requests to `https://bzz.limo/bzz/...`. Inspect the HTML root's `data-asset-source=swarm` attribute.

Implementation: `scripts/swarm-public-assets.ts`, `scripts/lib/public-theme.ts`, `scripts/lib/swarm-theme.ts`, `scripts/arkiv-theme.ts`, `server/arkiv/ThemePublication.ts`, `server/arkiv/ArkivArchive.ts`, `server/assets/ThemeApi.ts`, `src/assets/remote.ts`, `src/assets/schema.ts` and both render adapters. See [theme pack guidelines](../docs/THEME_PACKS.md).

## Remaining submission details

- Public postage batch ID: awaiting the gateway operator; not fabricated or inferred from the content hash.
- Postage supplier: Swarm Foundation public gateway; specific funding wallet/batch attribution awaiting confirmation.
- Retention and service limits: awaiting the operator; no permanent-storage guarantee is claimed.
- Demo-video timestamp: add after recording.
- Friction: the normal Bee upload path assumes private postage endpoints. Subsidised gateways need a separate path; the public UI's published 10 MB limit prompted bounded collections and a release index. Original uploads used the standard public gateway before the booth supplied bzz.limo; all assets were independently verified through bzz.limo without re-uploading identical PNGs.

Only public unencrypted asset references are published. Requirements: https://ethglobal.com/events/mumbai/prizes/arkiv.
