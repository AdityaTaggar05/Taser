import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtworkLoader, artworkSheetKey } from '../src/assets/ArtworkLoader';
import { registeredThemes } from '../src/assets/catalog';

afterEach(() => vi.useRealTimers());

function fixture(timeoutMs = 45_000) {
  const cached = new Set<string>();
  const target = {
    has: (key: string) => cached.has(key),
    load: vi.fn(async (pack, id, _signal) => {
      cached.add(artworkSheetKey(pack, id));
    }),
    register: vi.fn(),
  };
  const progress = vi.fn();
  return { cached, target, progress, loader: new ArtworkLoader(target, progress, timeoutMs) };
}

describe('theme artwork loading', () => {
  it('loads only the requested theme, shares concurrent requests, and reuses registered artwork', async () => {
    const { loader, target, progress } = fixture();
    const pack = registeredThemes[0];
    const first = loader.ensure(pack);
    expect(loader.ensure(pack)).toBe(first);
    await first;
    const count = new Set(Object.values(pack.manifest.sprites).map((s) => s.sheet)).size;
    expect(target.load).toHaveBeenCalledTimes(count);
    expect(target.load.mock.calls.every(([p]) => p === pack)).toBe(true);
    expect(target.register).toHaveBeenCalledExactlyOnceWith(pack);
    expect(loader.isReady(pack)).toBe(true);
    expect(loader.isReady(registeredThemes[1])).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(pack, count, count);
    await loader.ensure(pack);
    expect(target.load).toHaveBeenCalledTimes(count);
  });

  it('limits simultaneous gateway requests', async () => {
    const { loader, target } = fixture();
    let active = 0,
      peak = 0;
    target.load.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    await loader.ensure(registeredThemes[0]);
    expect(peak).toBe(6);
  });

  it('rejects a stalled read or decoder, aborts all workers, and never marks it ready', async () => {
    vi.useFakeTimers();
    const { loader, target } = fixture(100);
    target.load.mockImplementation(() => new Promise(() => {}));
    const attempt = loader.ensure(registeredThemes[0]);
    const result = expect(attempt).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(target.load.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
    expect(target.register).not.toHaveBeenCalled();
    expect(loader.isReady(registeredThemes[0])).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a failure automatically; an explicit retry reuses successfully loaded sheets', async () => {
    const { loader, target, cached } = fixture();
    const pack = registeredThemes[0];
    const id = Object.values(pack.manifest.sprites)[0].sheet;
    cached.add(artworkSheetKey(pack, id));
    target.load.mockRejectedValue(new Error('Gateway unavailable'));
    const attempt = loader.ensure(pack);
    await expect(attempt).rejects.toThrow('Gateway unavailable');
    const calls = target.load.mock.calls.length;
    await expect(loader.ensure(pack)).rejects.toThrow('Gateway unavailable');
    expect(target.load).toHaveBeenCalledTimes(calls);
    expect(target.load.mock.calls.every(([, sheet]) => sheet !== id)).toBe(true);
    target.load.mockImplementation(async (p, sheet) => {
      cached.add(artworkSheetKey(p, sheet));
    });
    loader.retry(pack);
    await loader.ensure(pack);
    expect(loader.isReady(pack)).toBe(true);
    expect(target.load.mock.calls.every(([, sheet]) => sheet !== id)).toBe(true);
  });

  it('keeps another theme usable when one theme fails', async () => {
    const { loader, target } = fixture();
    target.load.mockImplementation(async (pack) => {
      if (pack === registeredThemes[1]) throw new Error('Unavailable');
    });
    await expect(loader.ensure(registeredThemes[1])).rejects.toThrow('Unavailable');
    await loader.ensure(registeredThemes[0]);
    expect(loader.isReady(registeredThemes[0])).toBe(true);
    expect(loader.isReady(registeredThemes[1])).toBe(false);
  });
});
