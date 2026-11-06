import {createPublicClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {http, formatEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {importKey} from 'arkiv-encryption';
import {configuredEnv} from './arkiv-env.mjs';

// Read-only preflight. Do not log arbitrary SDK errors: they can contain keyed RPC URLs.
try {
  const env = configuredEnv();
  if (!env.ARKIV_ACCESS_KEY?.trim()) throw new Error('configuration');
  const account = privateKeyToAccount(env.ARKIV_PRIVATE_KEY);
  await importKey(env.ARKIV_ENCRYPTION_KEY);
  const reader = createPublicClient({chain: rabdi({accessKey: env.ARKIV_ACCESS_KEY}),
    transport: http(undefined, {retryCount: 0, timeout: 10_000,
      fetchOptions: {cache: 'no-store', redirect: 'error'}}), cacheTime: 0});
  const chainId = await reader.getChainId();
  if (chainId !== 7794095) throw new Error('network');
  const balance = await reader.getBalance({address: account.address, blockTag: 'latest'});
  console.log(`Network: Rabdi (${chainId})`);
  console.log(`Public server signer address: ${account.address}`);
  console.log(`Balance: ${formatEther(balance)} tGLM`);
  console.log('Encryption key: valid (not displayed).');
  console.log('No transaction was sent.');
  if (balance === 0n) {
    console.error('The generated server signer above has no tGLM. The wallet used to create an access key may be a different address; access keys do not share wallet balances.');
    console.error('Fund the printed signer address on Rabdi, either directly through the faucet or by transferring faucet tGLM from your funded wallet. Then run this check again.');
    console.error('Faucet: https://hub.arkiv.network/faucet');
    process.exitCode = 1;
  }
} catch {
  console.error('Arkiv check failed. Check ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY and ARKIV_ENCRYPTION_KEY in .env.local, and your network connection. No transaction was sent.');
  process.exitCode = 1;
}
