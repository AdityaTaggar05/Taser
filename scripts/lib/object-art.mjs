import { readFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Approved shipping-crate / recessed-plate study. Preserve the generated PNG bytes. */
export async function applyObjectArt(manifest, directory, repo) {
  const source = resolve(repo, 'public/art-reviews/crate-pressure-v1');
  const review = JSON.parse(await readFile(resolve(source, 'review-manifest.json'), 'utf8'));
  for (const [id, name] of [
    ['11-standard-crates', 'design-sheet'],
    ['03-pressure-switches', 'pressure-states'],
  ]) {
    const input = resolve(source, review.sheets[name].file),
      data = await readFile(input),
      file = 'sheets/' + id + '.png';
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== review.sheets[name].sha256) throw new Error('Approved object art changed');
    await copyFile(input, resolve(directory, file));
    manifest.sheets[id] = {
      file,
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
      bytes: data.length,
      sha256: hash,
    };
  }
  const states = ['up', 'press1', 'press2', 'held', 'release1', 'release2'];
  for (const owner of ['neutral', 'p1', 'p2']) {
    const frame = review.sprites[owner + '.crate'].frame,
      height = (0.8 * frame.h) / frame.w;
    manifest.sprites['crate.' + owner] = {
      sheet: '11-standard-crates',
      frame,
      render: { width: 0.8, height, originX: 0.5, originY: 1 - 0.35 / height },
    };
    // One canvas and pivot across the six states avoids trim-induced animation jitter.
    const entries = states.map((state) => review.sprites[owner + '.' + state]);
    const x = Math.min(...entries.map((e) => e.frame.x - e.cell.x)),
      y = Math.min(...entries.map((e) => e.frame.y - e.cell.y));
    const right = Math.max(...entries.map((e) => e.frame.x - e.cell.x + e.frame.w)),
      bottom = Math.max(...entries.map((e) => e.frame.y - e.cell.y + e.frame.h));
    entries.forEach((e, i) => {
      const frame = { x: e.cell.x + x, y: e.cell.y + y, w: right - x, h: bottom - y };
      manifest.sprites[`switch.${owner}.${states[i]}`] = {
        sheet: '03-pressure-switches',
        frame,
        render: { width: 0.98, height: (0.98 * frame.h) / frame.w, originX: 0.5, originY: 0.5 },
      };
    });
  }
}
