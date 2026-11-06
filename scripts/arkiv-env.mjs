import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export function localEnv(directory = process.cwd()) {
  const values = {};
  for (const name of ['.env', '.env.local']) {
    const path = resolve(directory, name);
    if (existsSync(path)) Object.assign(values, parseEnv(readFileSync(path, 'utf8')));
  }
  return values;
}

export function configuredEnv(directory = process.cwd()) {
  return { ...localEnv(directory), ...process.env };
}
