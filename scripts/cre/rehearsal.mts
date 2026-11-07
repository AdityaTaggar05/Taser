import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CertificationApi } from '../../server/certification/Api';
import type { ArchiveRecord, ArchiveRef } from '../../server/arkiv/archive';
import { cleanDraft } from '../../src/core/levelValidation';
import {
  checkInput,
  RULES_HASH,
  levelHash,
  witnessCommitment,
  type VerificationInput,
} from '../../src/certification/model';

// The Node CLI consumes the user's environment opaquely. No key or token is printed.
if ((process.env.CRE_API_TOKEN?.length ?? 0) < 32)
  throw new Error('Configure the local verifier API token before starting rehearsal.');
const db = new DatabaseSync(process.env.AUTH_DB_PATH ?? resolve('.data/accounts.sqlite'), {
  readOnly: true,
});
const row = db
  .prepare(
    "SELECT record,ref FROM level_publications WHERE category='campaign' ORDER BY CAST(json_extract(record,'$.campaignSlot') AS INTEGER) LIMIT 1",
  )
  .get();
db.close();
if (!row) throw new Error('No stored campaign snapshot is available for rehearsal.');
const record = JSON.parse(String(row.record)) as ArchiveRecord,
  ref = JSON.parse(String(row.ref)) as ArchiveRef;
const level = cleanDraft(record.level),
  salt = ('0x' + randomBytes(32).toString('hex')) as `0x${string}`,
  id = ('0x' + randomBytes(32).toString('hex')) as `0x${string}`;
const input: VerificationInput = {
  level,
  salt,
  request: {
    id,
    levelId: record.id,
    target: 'campaign',
    draftKey: ref.entityKey as `0x${string}`,
    levelHash: levelHash(level),
    witnessCommitment: witnessCommitment(level, salt),
    rulesHash: RULES_HASH,
  },
};
checkInput(input);
// One immutable in-memory snapshot serves both HTTP reads throughout this rehearsal.
const api = new CertificationApi({
  pendingCertifications: () => [input.request],
  verificationRequest: (requestId) => {
    if (requestId !== id) throw new Error('Unknown rehearsal.');
    return input.request;
  },
  verificationInput: async (requestId) => {
    if (requestId !== id) throw new Error('Unknown rehearsal.');
    return input;
  },
});
const server = createServer((req, res) => {
  void api.handle(req, res).catch(() => {
    res.statusCode = 503;
    res.end();
  });
});
server.on('error', () => {
  console.error('Local rehearsal gateway could not start. Check port 5185.');
  process.exitCode = 1;
});
server.listen(5185, '127.0.0.1', () => {
  const directory = resolve('.data/cre');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(directory, 'rehearsal-trigger.json'),
    JSON.stringify({ submissionId: id }) + '\n',
    { mode: 0o600 },
  );
  console.log('WeldPoint rehearsal gateway: http://127.0.0.1:5185');
  console.log('Source: stored campaign snapshot ' + record.id + ' (read-only local projection).');
  console.log('Trigger: .data/cre/rehearsal-trigger.json');
  console.log('No Arkiv read/write, certificate, wallet operation, or publication occurs.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
