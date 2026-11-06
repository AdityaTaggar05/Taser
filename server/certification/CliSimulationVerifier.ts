import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  requestHash,
  validProof,
  type CertificationRequest,
  type CliSimulationProof,
} from '../../src/certification/model';
import { parseConfig } from '../../cre/workflow/config';
import { parseCliResult } from './cliResult';
import type { CertificationRegistry } from './Registry';

export interface CliVerifierOptions {
  apiBase: string;
  databasePath: string;
  root?: string;
  bin?: string;
  timeoutMs?: number;
}
export class CliSimulationVerifier implements CertificationRegistry {
  readonly mode = 'cli-simulation';
  private db: DatabaseSync;
  private lockPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private attempts = new Map<string, number>();
  private root: string;

  constructor(private options: CliVerifierOptions) {
    parseConfig({ mode: 'local-simulation', apiBase: options.apiBase, authorizedKeys: [] });
    this.root = resolve(options.root ?? process.cwd());
    mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    this.lockPath = options.databasePath + '.lock';
    try {
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') unlinkSync(this.lockPath);
        }
      }
    } catch {
      /* Exclusive creation below handles absent/invalid locks. */
    }
    let fd: number;
    try {
      fd = openSync(this.lockPath, 'wx', 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    } catch {
      throw new Error(
        'Another CRE simulator owns this receipt database. Stop it before starting this instance.',
      );
    }
    try {
      const file = openSync(options.databasePath, 'a', 0o600);
      closeSync(file);
      this.db = new DatabaseSync(options.databasePath);
      this.db.exec(
        'PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS cli_receipts(request_id TEXT PRIMARY KEY,commitment TEXT NOT NULL,proof TEXT NOT NULL);',
      );
    } catch {
      unlinkSync(this.lockPath);
      throw new Error('CRE simulation receipts could not be opened.');
    }
  }

  async read(request: CertificationRequest): Promise<CliSimulationProof | null> {
    const row = this.db
      .prepare('SELECT commitment,proof FROM cli_receipts WHERE request_id=?')
      .get(request.id);
    if (!row) return null;
    const proof: unknown = JSON.parse(String(row.proof));
    if (
      row.commitment !== requestHash(request) ||
      !validProof(proof) ||
      proof.mode !== 'cli-simulation' ||
      requestHash(proof.request) !== requestHash(request)
    )
      throw new Error('CRE simulation receipt mismatch.');
    return proof;
  }

  verify(request: CertificationRequest): Promise<CliSimulationProof | null> {
    const task = this.queue.then(async () => {
      if (this.closed) return null;
      const prior = await this.read(request);
      if (prior) return prior;
      const last = this.attempts.get(request.id) ?? 0;
      if (Date.now() - last < 60_000) return null;
      this.attempts.set(request.id, Date.now());
      const directory = mkdtempSync(resolve(dirname(this.options.databasePath), 'cli-run-'));
      try {
        const config = resolve(directory, 'config.json');
        writeFileSync(
          config,
          JSON.stringify({
            mode: 'local-simulation',
            apiBase: this.options.apiBase,
            authorizedKeys: [],
          }),
          { mode: 0o600 },
        );
        const emptyEnv = resolve(directory, '.env');
        writeFileSync(emptyEnv, '', { mode: 0o600 });
        const env: NodeJS.ProcessEnv = {
          PATH: resolve(this.root, 'node_modules/.bin') + ':' + (process.env.PATH ?? ''),
          CRE_API_TOKEN: process.env.CRE_API_TOKEN,
        };
        // Let the official CLI use its login session, network settings and verifier token.
        // Arkiv credentials and signing keys never enter the child environment.
        for (const key of [
          'HOME',
          'XDG_CONFIG_HOME',
          'XDG_CACHE_HOME',
          'CRE_API_KEY',
          'HTTP_PROXY',
          'HTTPS_PROXY',
          'ALL_PROXY',
          'NO_PROXY',
          'SSL_CERT_FILE',
          'SSL_CERT_DIR',
          'NODE_EXTRA_CA_CERTS',
        ])
          if (process.env[key] !== undefined) env[key] = process.env[key];
        const stdout = await this.run(
          [
            'workflow',
            'simulate',
            'level-verification',
            '--target',
            'local-simulation',
            '--non-interactive',
            '--trigger-index',
            '0',
            '--config',
            config,
            '--env',
            emptyEnv,
            '--http-payload',
            JSON.stringify({ submissionId: request.id }),
          ],
          env,
        );
        const verdict = parseCliResult(stdout, request),
          proof: CliSimulationProof = {
            request,
            mode: 'cli-simulation',
            ...verdict,
            receiptId: ('0x' + randomBytes(32).toString('hex')) as `0x${string}`,
            completedAt: Date.now(),
          };
        this.db
          .prepare('INSERT INTO cli_receipts(request_id,commitment,proof) VALUES(?,?,?)')
          .run(request.id, requestHash(request), JSON.stringify(proof));
        return proof;
      } catch {
        throw new Error(
          'CRE CLI verification is temporarily unavailable. Check CLI login and workflow dependencies, then retry.',
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  private run(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolveOutput, reject) => {
      const child = spawn(this.options.bin ?? 'cre', args, {
        cwd: resolve(this.root, 'cre-project'),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      let output = '',
        bytes = 0,
        failed = false;
      const stop = () => {
        failed = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Process already exited. */
        }
      };
      const timer = setTimeout(stop, this.options.timeoutMs ?? 120_000);
      timer.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512_000) stop();
        else output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 512_000) stop();
      });
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('CRE could not start.'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 || failed) reject(new Error('CRE did not complete successfully.'));
        else resolveOutput(output);
      });
    });
  }

  close() {
    this.closed = true;
    this.db.close();
    try {
      if (readFileSync(this.lockPath, 'utf8') === String(process.pid)) unlinkSync(this.lockPath);
    } catch {}
  }
}
