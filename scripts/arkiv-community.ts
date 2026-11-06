import { formatEther, type Hex } from 'viem';
import { loadServerEnv, configuredArchive } from '../server/arkiv/config';
import { ArkivArchive } from '../server/arkiv/ArkivArchive';
import { ArchiveError } from '../server/arkiv/archive';

/** Operator maintenance only. Never exposed through the game HTTP API. */
loadServerEnv();
let archive: ReturnType<typeof configuredArchive> | undefined;
try {
  const write = process.argv.includes('--write');
  const marker = process.argv.indexOf('--entities');
  const keys = marker < 0 ? [] : process.argv.slice(marker + 1);
  if (write && (!keys.length || keys.some((key) => !/^0x[a-fA-F0-9]{64}$/.test(key))))
    throw new Error('Use --write --entities followed by the exact community entity keys.');
  archive = configuredArchive();
  if (!(archive instanceof ArkivArchive)) throw new Error('Arkiv is not configured.');
  console.log('Network: Rabdi (7794095). Publisher:', archive.signer);
  const inventory = await archive.communityDeletionInventory();
  console.log('Live community publications:', inventory.length);
  for (const entry of inventory) console.log(JSON.stringify(entry));
  if (!write) {
    let maximum = 0n;
    for (const entry of inventory) {
      const quote = await archive.quoteCommunityDeletion(entry.entityKey);
      maximum += BigInt(quote.maximumFeeWei);
      console.log(
        'Delete',
        entry.entityKey,
        'maximum fee:',
        formatEther(BigInt(quote.maximumFeeWei)),
        'tGLM',
      );
    }
    console.log(
      'Total maximum fee at current prices:',
      formatEther(maximum),
      'tGLM. No transaction was signed or sent.',
    );
  } else {
    for (const key of [...new Set(keys)]) {
      const ref = await archive.deleteCommunityEntity(key as Hex);
      console.log('Deleted and verified absent:', ref.entityKey, 'transaction:', ref.txHash);
    }
    console.log(
      'Remaining live community publications:',
      (await archive.communityDeletionInventory()).length,
    );
  }
} catch (error) {
  console.error(
    error instanceof ArchiveError
      ? error.message
      : 'Community maintenance stopped. Check configuration and exact entity arguments. No automatic transaction resubmission was attempted.',
  );
  process.exitCode = 1;
} finally {
  archive?.close();
}
