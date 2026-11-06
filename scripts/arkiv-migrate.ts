import { formatEther } from 'viem';
import { loadServerEnv, configuredArchive } from '../server/arkiv/config';
import { ArkivArchive } from '../server/arkiv/ArkivArchive';
import { LevelStore } from '../server/levels/LevelStore';
import { levels } from '../server/data/campaign';
loadServerEnv();
const archive = configuredArchive();
let store: LevelStore | undefined;
try {
  if (!(archive instanceof ArkivArchive)) throw new Error();
  if (process.argv.includes('--quote')) {
    let total = 0n;
    for (const level of levels) {
      const record = {
        id: `00000000-0000-4000-8000-${String(level.id).padStart(12, '0')}`,
        revision: 1,
        category: 'campaign' as const,
        ownerId: 'campaign',
        ownerName: 'WeldPoint',
        campaignSlot: level.id,
        updatedAt: 0,
        level,
      };
      const quote = await archive.quote(record);
      total += BigInt(quote.maximumFeeWei);
      console.log(
        `Campaign ${level.id}: gas cap ${quote.gas}; maximum fee ${formatEther(BigInt(quote.maximumFeeWei))} tGLM`,
      );
    }
    console.log(
      `${levels.length}-chamber maximum fee total at current prices: ${formatEther(total)} tGLM. No transaction was signed or sent.`,
    );
  } else {
    if (!process.argv.includes('--write')) throw new Error();
    store = new LevelStore(process.env.AUTH_DB_PATH ?? '.data/accounts.sqlite', archive);
    await archive.reconcilePending();
    await store.migrate(levels);
    console.log('Campaign and existing saved levels verified on Arkiv.');
    for (const c of store.campaign()) console.log(`Campaign ${c.slot}: ${c.entityKey}`);
  }
} catch {
  console.error(
    'Arkiv migration stopped. Check local configuration, approved fee budgets and the durable journal. No automatic transaction retries were attempted.',
  );
  process.exitCode = 1;
} finally {
  if (store) store.close();
  else archive.close();
}
