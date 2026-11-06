import { readFile, writeFile, rename } from 'node:fs/promises';
import { formatEther } from 'viem';
import { loadServerEnv, configuredArchive } from '../server/arkiv/config';
import { ArkivArchive } from '../server/arkiv/ArkivArchive';
import { validateThemePublication } from '../server/arkiv/ThemePublication';
import { validateDeployment } from '../src/assets/schema';
import { prepareUpload } from './lib/swarm-theme';
import { makePack } from '../src/assets/catalog';
import { loadPublishedTheme } from '../src/assets/remote';
import { themeSourceFromArgs } from './lib/theme-source';
loadServerEnv();
let archive: ReturnType<typeof configuredArchive> | undefined;
try {
  const source = themeSourceFromArgs(),
    path = source.deploymentFile,
    deployment = validateDeployment(JSON.parse(await readFile(path, 'utf8')));
  if (
    !deployment.reference ||
    !deployment.verifiedAt ||
    !deployment.manifestSha256 ||
    !deployment.releaseSha256
  )
    throw new Error();
  const directory = 'public/themes/' + source.id,
    manifest = JSON.parse(await readFile(directory + '/manifest.json', 'utf8'));
  const bundle = await prepareUpload(directory);
  if (bundle.manifestSha256 !== deployment.manifestSha256) throw new Error();
  await loadPublishedTheme(makePack(manifest, { ...deployment, arkiv: undefined }));
  const record = validateThemePublication({
    category: 'theme',
    id: manifest.id + '@' + manifest.version,
    revision: 1,
    themeId: manifest.id,
    version: manifest.version,
    swarmReference: deployment.reference,
    manifestSha256: deployment.manifestSha256,
    releaseSha256: deployment.releaseSha256,
    updatedAt: 0,
  });
  archive = configuredArchive();
  if (!(archive instanceof ArkivArchive)) throw new Error();
  if (process.argv.includes('--quote')) {
    const quote = await archive.quote(record);
    console.log(
      `Theme publication maximum estimated fee: ${formatEther(BigInt(quote.maximumFeeWei))} tGLM; gas cap ${quote.gas}. No transaction sent.`,
    );
  } else if (process.argv.includes('--write')) {
    await archive.reconcilePending();
    const ref = await archive.putTheme(record),
      readback = await archive.readTheme(ref.entityKey);
    if (JSON.stringify(readback) !== JSON.stringify(record)) throw new Error();
    const next = {
      ...deployment,
      arkiv: { entityKey: ref.entityKey, publisher: archive.signer, txHash: ref.txHash },
    };
    const temp = path + '.tmp';
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n');
    await rename(temp, path);
    const evidencePath = source.evidenceFile,
      evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    await writeFile(
      evidencePath + '.tmp',
      JSON.stringify({ ...evidence, arkiv: next.arkiv, arkivExpiresAt: ref.expiresAt }, null, 2) +
        '\n',
    );
    await rename(evidencePath + '.tmp', evidencePath);
    console.log('Verified Arkiv theme entity: ' + ref.entityKey);
    console.log('Transaction: ' + ref.txHash);
    console.log('Swarm release reference: ' + readback.swarmReference);
  } else throw new Error();
} catch (error) {
  console.error(
    'Arkiv theme operation stopped: ' +
      (error instanceof Error && error.message.startsWith('Another server')
        ? error.message
        : 'Check the configured budgets, writer lock, connectivity and durable journal. No automatic resubmission was attempted.'),
  );
  process.exitCode = 1;
} finally {
  archive?.close();
}
