import { appendFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateKey, importKey } from 'arkiv-encryption';
import { localEnv } from './arkiv-env.mjs';

// This command only prepares local configuration. It never sends an RPC or transaction.
try {
  const values = localEnv();
  const additions = {};
  if (!values.ARKIV_PRIVATE_KEY) additions.ARKIV_PRIVATE_KEY = generatePrivateKey();
  if (!values.ARKIV_ENCRYPTION_KEY) additions.ARKIV_ENCRYPTION_KEY = generateKey();
  if (values.ARKIV_ACCESS_KEY === undefined) additions.ARKIV_ACCESS_KEY = '';
  // A zero budget keeps writes disabled until an explicit fee budget is configured.
  if (values.ARKIV_MAX_TX_FEE_GLM === undefined) additions.ARKIV_MAX_TX_FEE_GLM = '0';
  if (values.ARKIV_DAILY_FEE_BUDGET_GLM === undefined) additions.ARKIV_DAILY_FEE_BUDGET_GLM = '0';
  const complete = { ...values, ...additions };
  const account = privateKeyToAccount(complete.ARKIV_PRIVATE_KEY);
  await importKey(complete.ARKIV_ENCRYPTION_KEY);
  const target = resolve('.env.local');
  if (Object.keys(additions).length) {
    const text =
      '\n# Server-only Arkiv setup. Keep a private backup; do not commit.\n' +
      Object.entries(additions)
        .map(([name, value]) => `${name}=${value}\n`)
        .join('');
    appendFileSync(target, text, { mode: 0o600 });
  }
  if (existsSync(target)) chmodSync(target, 0o600);
  console.log('Local Arkiv configuration is ready. No transaction was sent.');
  console.log(`Public server signer address: ${account.address}`);
  console.log('Keep a private backup of .env.local, especially ARKIV_ENCRYPTION_KEY.');
  console.log('Add ARKIV_ACCESS_KEY in .env.local, then fund the public signer address on Rabdi.');
  console.log('Run npm run arkiv:check to verify the connection and test-token balance.');
} catch {
  console.error(
    'Could not prepare Arkiv configuration. Check local file permissions and existing key formats. Existing keys were not replaced.',
  );
  process.exitCode = 1;
}
