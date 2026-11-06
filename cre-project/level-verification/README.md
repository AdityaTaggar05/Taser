# Taser level verification

Created with the official `hello-world-ts` template using `cre init`. The entry
point calls Taser's shared CRE verifier and deterministic game engine in this
repository. The generic cron handler and examples have been replaced.

## Toolchain and dependencies

The installed Chainlink skill requires Bun 1.2.21 or newer. Taser provides Bun
1.4.4 in its root development dependencies. From this workflow directory:

```sh
PATH="$PWD/../../node_modules/.bin:$PATH" bun install
PATH="$PWD/../../node_modules/.bin:$PATH" bunx cre-setup
```

The generated dependency range resolves to CRE SDK 1.23.0; `bun.lock` pins the
installation. The entry point imports the existing Taser verifier, so this
scaffold runs inside the Taser repository rather than as a standalone package.

## Local rehearsal

From the Taser root, start:

```sh
npm run cre:rehearsal
```

It serves one immutable snapshot from the existing private campaign catalog on
loopback port 5185, protected by the existing verifier token. It does not access
Arkiv or use a wallet. Node and the CRE CLI consume `.env.local` without displaying
it. No credentials are stored in this scaffold.

In another terminal, from the Taser root:

```sh
cd cre-project
PATH="$PWD/../node_modules/.bin:$PATH" cre workflow simulate level-verification \
  --target staging-settings --non-interactive --trigger-index 0 \
  --env ../.env.local --http-payload ../.data/cre/rehearsal-trigger.json
```

The dedicated receiver-free target runs the same handler:

```sh
PATH="$PWD/../node_modules/.bin:$PATH" cre workflow simulate level-verification \
  --target local-simulation --non-interactive --trigger-index 0 \
  --env ../.env.local --http-payload ../.data/cre/rehearsal-trigger.json
```

The workflow performs real authenticated HTTP calls to the rehearsal gateway,
validates layout and salted witness commitments, and independently replays the
submitted moves. Only the compact verdict enters consensus aggregation. A valid
witness logs `Taser local-simulation: WINNING solution; ... turns`.

This rehearsal validates a stored local catalog snapshot. It does not validate a
fresh Arkiv read, an onchain request, a DON execution or a certificate. The local
branch returns before constructing an EVM client or creating a report. Never
deploy or broadcast either rehearsal target.

The installed CLI requires an RPC entry even for this HTTP-only path. Both local
targets retain the public Sepolia RPC URL supplied by the official template; the
local handler does not construct an EVM client or issue an onchain read/write.

## Certificate flow prerequisites

The existing publication pipeline uses the protected pending-submission API, the
actual registered Sepolia request commitment, and the configured receiver. The
`production-settings` config deliberately fails closed until you provide an HTTPS
game API origin, an actual nonzero registry address and authorized HTTP trigger
addresses. Its RPC comes from `CRE_SEPOLIA_RPC_URL`; no address or RPC key is guessed.

After a successful local simulation, check and request CRE Early Access with:

```sh
cre account access --help
cre account access
```

Private registry workflow management needs approval, an enabled private registry
and authentication, but no linked wallet, RPC or gas. Receiver deployment and
onchain report delivery have separate onchain prerequisites. No deployment,
activation or secret upload is part of this setup. See the repository's
`docs/CRE_CERTIFICATION.md` for the full trust boundary.
