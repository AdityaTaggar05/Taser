# CRE level certification

New community and campaign publications use the same immutable submission pipeline. Existing Arkiv publications remain playable as **Legacy · server verified**; they are not retroactively represented as CRE-certified. Creator drafts can be edited until submission. Internal draft counters still detect stale saves, but a published identity cannot be edited, updated, promoted to another collection or republished. There is no copy/remix/export action for a frozen submission. Existing legacy campaign templates remain available under the old completion/admin policy; newly certified campaign levels cannot become templates.

## Submission lifecycle

1. Save the encrypted draft through the existing Arkiv writer and approved Rabdi caps. Publish first runs local validation for immediate feedback, then freezes the exact confirmed draft, destination and optional campaign slot in private durable SQLite.
2. A pending submission has a random 32-byte request ID, layout hash, salted witness commitment and rules hash. The private salt and move lists never enter public metadata. The creator sees **Submission frozen** and can inspect/playtest the read-only layout. Pending content is absent from discovery and cannot start a game.
3. The selected verification mode checks the frozen submission. In `cli-simulation`, background maintenance invokes the actual CRE CLI over the protected pending-submission API and accepts only a successful final result matching the request ID and complete commitment. In the Sepolia modes, an operator first registers the request commitment onchain; the workflow reads that commitment before fetching the pinned draft. All paths check the fingerprints and replay the same deterministic engine. Only the compact verdict enters consensus aggregation; the local simulator does not perform real DON consensus.
4. CLI mode persists a private execution receipt before approving the submission. The receipt includes request, verdict, winning turn, workflow binary fingerprint, random receipt ID and completion time. It contains no fabricated chain ID, address or transaction. In Sepolia modes, CRE instead generates an EVM report and delivers it through the configured forwarder. The report binds request, commitment, pass/fail, winning turn, Sepolia chain ID and registry address; the registry checks its sender and immutable request, with workflow identity checks in DON mode.
5. The server validates the durable receipt or registry result, then archives the approved publication through the same exclusive Arkiv signer/journal. Publication begins its normal two-day community lifetime only at that final write. Campaign lifetime is unchanged. Only confirmed Arkiv publication enters discovery. CLI-approved cards say **CRE SIMULATION VERIFIED**; the receipt is a trusted-server execution record, not a DON or Sepolia certificate.

A rejected solution unlocks the draft. A corrected submission gets a new request ID and salt. An RPC/API timeout remains pending and locked. An approved result with an uncertain Arkiv write stays approved and locked; receipt reconciliation does not resubmit a different entity. Background maintenance processes at most two certification jobs per pass. Refresh verification is an authenticated owner action; polling GETs never invoke a writer.

The final public record remains permanently read-only after the entity expires. Preserve the SQLite databases and transaction journals: they retain submission locks, pending work and recovery state beyond Arkiv's current-state availability.

## Scope and trust

Published campaign and community cards expose certificate evidence without the solution, witness salt or private draft. Sepolia-backed proofs include a **Sepolia certificate** link to the recorded registry and an expandable certificate ID with a copy action. On Etherscan, use **Contract → Read Contract → certifications(id)**, paste that ID and compare `exists=true`, `valid=true`, `steps` and the displayed expected commitment. Read Contract requires the registry source to be verified on the explorer. The linked block is the server's observation snapshot, not a claimed certificate transaction block; the current proof does not contain a transaction hash.

Local CLI receipts show **CRE simulation receipt** with the receipt ID and workflow hash. They do not produce Sepolia links. Legacy levels and explicit test proofs do not claim a public certificate. Adding explorer links does not deploy contracts or upload receipts to Sepolia.

- **CRE CLI simulation** can approve publications without a Sepolia receiver when explicitly selected. EVM simulation uses a separate simulation registry. Compiling WASM or replaying a local unit test is not a successful CRE CLI simulation and is never reported as live DON execution.
- The game server never accepts an HTTP callback saying `approved: true`. It validates its own successful CLI subprocess result or reads the configured Sepolia contract. Unconfigured verification does not fall back to the server's initial verdict.
- The authenticated witness gateway decrypts the pinned Arkiv draft and checks that it matches the frozen submission before supplying it. This gateway remains trusted for plaintext-to-archive binding. The authorized verifier can see the solution. This is not confidential computation or a zero-knowledge proof.
- The workflow verifies the submitted winning witness, not every solution, uniqueness, shortest path, human authorship or level quality. Alternate winning routes remain valid.
- Rules are currently identified by the shared `taser-rules-v1` hash. A mechanics change requires an explicit rules-version/compatibility plan and new workflow build; do not silently reuse the identifier for changed rules.
- Simulation reads certificates at least two blocks behind the current Sepolia head; live DON mode uses finalized blocks. Simulation certificates are visibly labeled and use a different deployment from live certificates. Simulation forwarders are test infrastructure, not production authentication.
- New level certification does not change automatic player-run publication. Run certification is a later feature.

## Build and test without credentials

```sh
npm install
npm test
npm run build
npm run cre:typecheck
npm run cre:contract
npm run cre:build
npm run cre:check
```

The CRE SDK and Bun are pinned development dependencies. `cre:build` uses the official SDK compiler, downloading checksum-verified Javy tooling if necessary, and writes the WASM binary under ignored `.data/cre/`. `cre:contract` writes its ABI/bytecode there too. Contract tests execute actual compiled bytecode in a local EVM; test archives and registries are explicit injections and cannot be selected through application environment configuration.

No command above deploys a contract, registers a request, broadcasts a report, or writes an Arkiv entity. CRE CLI simulation additionally needs a separately installed CRE CLI and a logged-in Chainlink account.

## Verified receiver-free rehearsal

### Automatic publication after a real CLI execution

Install the generated workflow dependencies and WASM tooling, keep the CLI logged
in, then run this from the Taser root:

```sh
npm run cre:local-mode
npm run dev
```

The first command preserves other local settings and selects
`CRE_MODE=cli-simulation`. It performs no workflow execution or transaction itself.
The server uses `CRE_API_BASE` (or `APP_ORIGIN`, then loopback port 5173) to fetch
its own frozen submissions. Configure that origin when serving another port.
Publication requires the existing working Arkiv storage and approved write caps;
no Sepolia registry, CRE wallet key or DON deployment is needed in this mode.

Publish initially returns **Pending**. The ten-second maintenance loop runs at
most two jobs per pass and only one CLI subprocess at a time. An owner can also
use Refresh verification. Plain GET polling never launches the CLI. Each execution
uses the equivalent of:

```sh
cre workflow simulate level-verification --target local-simulation \
  --non-interactive --trigger-index 0 --config /private/run/config.json \
  --env /private/run/.env --http-payload '{"submissionId":"0x..."}'
```

The paths and ID above illustrate per-run values generated by the server; do not
copy this illustrative command. The executable command for manual rehearsal is
shown below. The actual worker uses fixed arguments without a shell, no broadcast
flag, the existing official scaffold, and normal compilation/typechecking. It
passes an empty environment file and a minimal process environment containing the
verifier token, CLI authentication and network settings. Arkiv credentials and
wallet signing keys are not passed. Private configs are removed after execution;
raw child logs are not stored or returned to the browser.

The worker requires exit code zero, exactly one final structured workflow result,
the exact submission ID/commitment, a bounded verdict, and the CLI's workflow
fingerprint. Logs that merely say `WINNING`, client flags and owner callbacks cannot
approve anything. Timeouts, unavailable CLI/authentication, malformed results and
mismatches leave the submission pending, with at least a minute between retries.
Arkiv publication failures preserve the approved receipt for writer reconciliation
without rerunning verification.

Receipts live in `.data/cre/cli-receipts.sqlite` by default, configurable through
`CRE_CLI_RECEIPTS_PATH`, under an exclusive process lock. Preserve a consistent
SQLite backup including active WAL state alongside the account/archive databases.
Startup validates archived CLI proofs against these private receipts and fails
closed if a receipt is missing or differs. Restoring only public Arkiv entities is
not sufficient to re-establish the local execution evidence. A later DON move
needs an explicit historical-verifier migration plan.

This is an explicitly trusted-server mode. The server owns the executable and
receipt store; a receipt is not a cryptographic proof of independent execution.
The published payload still encrypts the solution and salt, and successful
publication permanently locks the submitted identity.

### Standalone catalog rehearsal

The project-local Chainlink skill is installed at `.agents/skills/chainlink-cre-skill`.
The official `cre init` TypeScript scaffold is under `cre-project/level-verification`;
its entry point calls the same shared verifier used by the certificate flow.
The installed skill requires Bun 1.2.21+, and the project-local Bun 1.4.4 satisfies
that minimum. From the generated workflow directory, `bun install` and
`bunx cre-setup` install its dependencies and official WASM tooling.

To verify the HTTP/replay path before any registry exists, start this command from
the Taser root in one terminal:

```sh
npm run cre:rehearsal
```

It opens a loopback-only, token-authenticated gateway over an immutable snapshot
of the existing private SQLite campaign projection. It reads no Arkiv entity and
sends no transaction. Node consumes the existing `.env.local` opaquely; no key or
token is displayed. This is a rehearsal of catalog data, not a pending publication
or a fresh verification of the encrypted Arkiv bytes.

From another terminal at the Taser root:

```sh
cd cre-project
PATH="$PWD/../node_modules/.bin:$PATH" cre workflow simulate level-verification \
  --target staging-settings --non-interactive --trigger-index 0 \
  --env ../.env.local --http-payload ../.data/cre/rehearsal-trigger.json
```

The dedicated receiver-free target is also verified:

```sh
PATH="$PWD/../node_modules/.bin:$PATH" cre workflow simulate level-verification \
  --target local-simulation --non-interactive --trigger-index 0 \
  --env ../.env.local --http-payload ../.data/cre/rehearsal-trigger.json
```

Both commands completed through CRE CLI v1.39.0, with typechecking and default
simulation limits enabled, and printed:

```text
[USER LOG] Taser local-simulation: WINNING solution; 8 turns. No certificate or publication created.
```

These targets perform real authenticated HTTP reads, check the salted commitments
and replay the shared game engine. They return before EVM client construction,
report creation or delivery. They cannot approve a submission. Never deploy or
broadcast either rehearsal target. The CLI requires an RPC entry even for this
HTTP-only path; the scaffold retains its official template's public Sepolia RPC
for that startup check. No RPC key or account-specific address is guessed.

The actual certificate path below still requires a pinned draft, a registered
onchain request, and the appropriate configured registry. Production config fails
closed until the actual API origin, registry and authorized HTTP trigger addresses
are configured.

After simulation, `cre account access --help` confirms the request syntax and
`cre account access` checks or requests Early Access. Private registry management
requires approval and an enabled registry but no linked wallet, RPC or gas;
onchain receiver deployment and report delivery are separate operations.

## Configure locally when ready

1. Install the official [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation/macos-linux), create your account, and run `cre login` yourself. `cre workflow supported-chains` shows the forwarders enabled for that account. Select the Ethereum Sepolia **MockForwarder** for simulation. Do not use a guessed address or an EOA.
2. Run `npm run cre:setup`. It preserves existing secrets and generates a dedicated Sepolia signer plus an independent `CRE_API_TOKEN` in ignored `.env.local`. It prints only the public signer address. Fund that address with Sepolia ETH through a faucet; do not paste its private key into chat.
3. Set `CRE_MODE=simulation`, `CRE_SEPOLIA_RPC_URL`, `CRE_FORWARDER_ADDRESS`, and reviewed `CRE_MAX_TX_FEE_ETH` / `CRE_DAILY_FEE_BUDGET_ETH` caps locally. These caps are separate from the approved Arkiv tGLM caps. Both default to zero, which disables operator writes.
4. Run `npm run cre:deploy` for a gas quote. Review the quote, then explicitly run `npm run cre:deploy -- --write` to deploy. Set the printed address as `CRE_REGISTRY_ADDRESS` and restart the game server. Its private key is used only by the operator script, not by the application server.
5. Create and submit a winning draft in the editor. Its private submission ID is visible in the frozen-submission banner. Quote registration using `npm run cre:register -- --submission 0x...`, then explicitly add `--write` to register it. Request registration is idempotent.
6. Run `npm run cre:build`, then `npm run cre:simulate -- --submission 0x...`. The operator writes private CLI configuration and trigger files under `.data/cre/` and invokes the actual CRE CLI in **dry-run** mode. This fetches the witness, reads Sepolia, replays the engine and prepares the report. A dry run does not publish the level, because no certificate transaction was sent.
7. To test a real certificate transaction, review CRE's broadcast behavior and fees first, then run from `.data/cre/`:

   ```sh
   cre workflow simulate . --target staging-settings --non-interactive \
     --trigger-index 0 --http-payload trigger.json --wasm workflow.wasm --broadcast
   ```

   Export `CRE_API_TOKEN`, `CRE_ETH_PRIVATE_KEY` and required RPC configuration in that local shell without sharing them. This explicit CRE CLI broadcast uses its own transaction submission; the operator deploy/register journal and caps do **not** govern it. The application checks the resulting certificate after two additional Sepolia blocks, then completes the bounded Arkiv publication. Use Refresh verification or wait for maintenance.

`cre:deploy` and `cre:register` sign exact transactions, fsync signed bytes/hash before submission, enforce conservative per-transaction/daily caps, and lock the dedicated signer. A recorded uncertain transaction is reconciled by hash on the next identical command and is never automatically resent. Keep its private journal. A reverted transaction or stale lock needs operator inspection rather than a blind retry.

The CLI account, RPC, funded wallet, forwarder, deployed registry and successful CLI execution are configuration-dependent. A working local build does not claim any of those external steps have happened.

## HTTP boundary

`GET /api/cre/submissions` returns at most ten pending request descriptors. `GET /api/cre/submissions/<id>/request` returns one descriptor. `GET /api/cre/submissions/<id>` returns its verification input only while pending. All require the separate `Authorization: Bearer <CRE_API_TOKEN>`, reject browser Origin headers, bound requests and use no-store responses. Session cookies alone grant no access. Never put the token, salt, solution, access-key RPC URL or archive-wide encryption key in URLs, public workflow configuration, reports or logs. Use HTTPS outside loopback simulation.

The workflow's input is just `{ "submissionId": "0x..." }`. API base, registry and mode are operator-controlled configuration, so a creator cannot inject an arbitrary HTTP endpoint. Each node returns only a compact verdict to consensus, avoiding putting the complete private level into consensus observations.

## Moving to a DON

Obtain deployment access, use the actual Sepolia KeystoneForwarder and deploy a new registry with `simulation=false` and the exact workflow ID. Configure authorized HTTP trigger keys and the workflow's verifier secret, deploy the workflow through CRE, and switch the server to `CRE_MODE=don` and the new registry. Production reports must include the proper 62-byte workflow metadata; simulation metadata is deliberately accepted only by the separate simulation instance. No runtime environment option enables the test registry.

This version trusts one configured registry per deployment. Use a separate application/archive namespace and database for the DON deployment, or implement a reviewed historical-registry migration before switching an existing catalog. Simulation certificates are never automatically promoted to DON certificates; switching addresses alone would prevent existing certified records from passing startup verification.
