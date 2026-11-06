import type { ThemePack } from './catalog';

export const artworkKey = (pack: ThemePack) => `${pack.id}@${pack.manifest.version}`;
export const artworkSheetKey = (pack: ThemePack, id: string) => `${artworkKey(pack)}:${id}`;

interface ArtworkTarget {
  has(key: string): boolean;
  load(pack: ThemePack, id: string, signal: AbortSignal): Promise<void>;
  register(pack: ThemePack): void;
}

/** One bounded attempt per theme. Failed attempts wait for an explicit retry. */
export class ArtworkLoader {
  private attempts = new Map<string, Promise<void>>();
  private ready = new Set<string>();

  constructor(
    private target: ArtworkTarget,
    private progress: (pack: ThemePack, loaded: number, total: number) => void,
    private timeoutMs = 45_000,
  ) {}

  isReady(pack: ThemePack) {
    return this.ready.has(artworkKey(pack));
  }

  retry(pack: ThemePack) {
    if (!this.isReady(pack)) this.attempts.delete(artworkKey(pack));
  }

  ensure(pack: ThemePack): Promise<void> {
    const key = artworkKey(pack);
    const existing = this.attempts.get(key);
    if (existing) return existing;
    const attempt = this.load(pack);
    this.attempts.set(key, attempt);
    return attempt;
  }

  private async load(pack: ThemePack) {
    const ids = [...new Set(Object.values(pack.manifest.sprites).map((sprite) => sprite.sheet))];
    const pending = ids.filter((id) => !this.target.has(artworkSheetKey(pack, id)));
    let loaded = ids.length - pending.length;
    const controller = new AbortController();
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      });
    });
    const timer = setTimeout(
      () => controller.abort(new Error('Artwork loading timed out. Please retry.')),
      this.timeoutMs,
    );
    try {
      this.progress(pack, loaded, ids.length);
      // Keep public gateways responsive rather than issuing every animation request at once.
      const workers = Array.from({ length: Math.min(6, pending.length) }, async () => {
        while (pending.length) {
          controller.signal.throwIfAborted();
          const id = pending.shift()!;
          await this.target.load(pack, id, controller.signal);
          controller.signal.throwIfAborted();
          this.progress(pack, ++loaded, ids.length);
        }
      });
      await Promise.race([Promise.all(workers), deadline]);
      this.target.register(pack);
      this.ready.add(artworkKey(pack));
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
