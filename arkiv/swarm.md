# Arkiv + Swarm integration evidence

## Current status

The shared theme integration and Bee upload/readback tooling are implemented locally. **No Swarm reference or new Arkiv entity linking it has been verified yet.** A usable upload endpoint and postage batch are still required. This file is a checklist for live evidence, not a claim of completed prize eligibility.

## Storage split

- Swarm: the public modern-gray collection, containing a manifest and 28 approved original PNGs. The manifest maps semantic roles to atlas rectangles and hashes. Gameplay, title, editor and interface sprites resolve through the same collection after deployment is verified.
- Arkiv Rabdi: existing encrypted level revisions, publication metadata and revision identities. The current level schema stores environment IDs, **not a Swarm reference**. The Arkiv-to-theme pointer remains pending; do not represent the environment ID alone as that link.

## Reproduce upload/read

1. Run `npm run assets:check`.
2. Set the Bee endpoint, existing usable batch and optional service token in private `.env.local`; see `.env.example`.
3. Run `npm run assets:upload`. The allowlist excludes source, credentials and databases. The command writes deployment data only after exact public readback of all collection files.
4. Run `npm run build`, restart and inspect browser image requests: every sprite should come from `<gateway>/bzz/<reference>/sheets/...png`.
5. Re-run `npm run assets:verify` to independently repeat hash verification. It does not re-upload.

Upload/read implementation: `scripts/swarm-assets.ts`, `scripts/lib/swarm-theme.ts`. Client resolution: `src/assets/schema.ts`, `src/assets/catalog.ts`, `src/render/environment.ts`, `src/assets/dom.ts`. Theme guidelines: `docs/THEME_PACKS.md`.

## Live evidence to fill after verification

- Swarm collection reference: pending.
- Public manifest URL: pending.
- Postage batch ID and buyer wallet or supplier: pending. Never include the authentication token.
- Upload Bee node/service: pending.
- Real Arkiv entity key: pending.
- Exact Arkiv field containing the Swarm reference/feed: pending implementation. Include pack ID/version and manifest hash; validate the trusted publisher before using it.
- End-to-end Arkiv pointer read followed by Swarm asset load: pending.
- Demo timestamp showing the working feature: pending.
- Friction observed: no event-specific upload endpoint or postage batch is configured locally. Public read gateways do not supply upload postage.

Use public unencrypted asset references for these public sprites. Do not publish an encrypted Swarm reference containing a decryption key in a public Arkiv field. Review current official prize requirements before submission: https://ethglobal.com/events/mumbai/prizes/arkiv.
