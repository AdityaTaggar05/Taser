# Docker hosting

The image includes Node 24, the CRE CLI, Bun, and installed workflow dependencies.
Builds need internet access. The official CRE installer verifies the pinned v1.39.0 release;
override with `--build-arg CRE_VERSION=vX.Y.Z` when upgrading. Record `cre version` after building and retain the tested image for deployment.
Development dependencies are deliberately retained for the runtime CRE compiler.

## Build and authenticate first

From the repository root, configure `.env.local` using `.env.example`. This file
is injected at runtime and excluded from the build context. Preserve your existing
Arkiv signer, encryption key, namespace and budgets. Never commit credentials.

```sh
docker compose build
docker compose run --rm --no-deps weldpoint cre version
docker compose run --rm --no-deps weldpoint cre login
docker compose run --rm --no-deps weldpoint cre whoami
```

Open the URL printed by `cre login` in your browser and complete sign-in/2FA.
The private `cre-session` volume retains the CLI session and tenant context for
both these commands and the running server. Re-run login when the session expires.
Do not bake that volume into an image or commit its contents. Alternatively, set
`CRE_API_KEY` in the runtime environment; Chainlink requires deploy-access approval
for API-key authentication. `CRE_API_TOKEN` is a separate WeldPoint verifier secret.

Official guidance: https://docs.chain.link/cre/guides/cli/managing-auth

For automatic local verification, set `CRE_MODE=cli-simulation` and a securely
generated `CRE_API_TOKEN` of at least 32 characters in `.env.local`. No Sepolia
signing key or registry is required for this mode. This produces simulation
receipts, not DON certification. The image installs the workflow dependencies
and runs `cre-setup` during build.

## Start and host

Set `APP_ORIGIN=https://your-domain.example` in `.env.local`, then:

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=100 weldpoint
```

Put an HTTPS reverse proxy on the host in front of `127.0.0.1:5173`. It must forward
WebSocket upgrades for `/co-op` and preserve Host/Origin. For example, a Caddy
site block `your-domain.example { reverse_proxy 127.0.0.1:5173 }` handles both.
For local HTTP testing use `APP_ORIGIN=http://localhost:5173`.
Demo identities remain disabled unless explicitly enabled with `DEMO_AUTH=true`.

Run one replica. In-memory parties and active games are lost on restart. SQLite
accounts, archive journals and CRE receipts live in `game-data`; back up this
volume with the service stopped, plus the encryption key separately. Do not run
`docker compose down -v` unless you intend to erase persisted state.

Existing host `.data` is not automatically migrated. Before replacing an existing
server, stop it and copy its complete `.data` directory into the named game-data
volume, preserving SQLite sidecar files and granting UID 1000 ownership. Do not
run two servers against the same signer/journal or migrate a live database.

`cre whoami` confirms authentication; it does not prove a successful workflow.
Verify a creator submission and its simulation receipt before relying on automatic
publication. Arkiv availability, funds/budgets and CLI account permissions remain
external prerequisites. Building this image does not deploy a workflow or a site.

## Archived CRE levels on a fresh host

CRE CLI login is separate from WeldPoint's verification configuration and receipt
storage. A fresh host can read the encrypted Arkiv catalog yet lack the private
receipts for previously published `cli-simulation` levels. Startup now excludes
publications whose certificate cannot be found, prints a count and recovery
instruction, and loads the remaining verified catalog. Those excluded levels
cannot be selected for play. Invalid/mismatched certificates and remote read
errors still fail verification; the server never trusts an archived proof alone.

To restore the excluded simulation levels, restore the original
`.data/cre/cli-receipts.sqlite` (with any SQLite sidecars, from a stopped server),
set `CRE_MODE=cli-simulation` and configure `CRE_API_TOKEN`, then restart. Logging
into CRE does not recreate these receipts. If the original receipts are lost,
keep those publications unavailable until an explicit re-verification/republication
workflow is performed. Never fabricate receipts from the archived proof.
