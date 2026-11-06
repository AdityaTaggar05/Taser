import { explorerLink, type ArkivActivity, type ArkivFeed } from '../network/arkiv';

/** A receipt can arrive between polls. Seed history once, then celebrate each verified move once. */
export class VerificationSignals {
  private source: ArkivFeed['storage'] | undefined;
  private seen = new Set<string>();

  receive(feed: ArkivFeed, silent = false): ArkivActivity[] {
    const baseline = this.source !== feed.storage;
    if (baseline) this.seen.clear();
    this.source = feed.storage;
    const arrivals: ArkivActivity[] = [];
    for (const activity of feed.activities) {
      if (
        feed.storage !== 'arkiv' ||
        activity.kind !== 'move' ||
        activity.state !== 'confirmed' ||
        !explorerLink('tx', activity.txHash) ||
        !explorerLink('entity', activity.entityKey)
      )
        continue;
      if (!baseline && !silent && !this.seen.has(activity.id)) arrivals.push(activity);
      this.seen.add(activity.id);
    }
    return arrivals.reverse();
  }

  reset() {
    this.source = undefined;
    this.seen.clear();
  }
}

/** Presentation only: the server's verified receipt is the sole trigger. Never initiates a write. */
export class ArchiveArrival {
  private root = document.createElement('div');
  private announce = document.createElement('div');
  private queue: ArkivActivity[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private animations = new Set<Animation>();
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private destination: () => HTMLElement) {
    this.root.className = 'arkiv-arrivals';
    this.root.setAttribute('aria-hidden', 'true');
    this.announce.className = 'arkiv-announcement';
    this.announce.setAttribute('role', 'status');
    this.announce.setAttribute('aria-live', 'polite');
    document.body.append(this.root, this.announce);
  }

  receive(activities: ArkivActivity[]) {
    if (!activities.length || document.hidden) return;
    this.announce.textContent =
      activities.length === 1
        ? `${activities[0].label}. Verified on chain.`
        : `${activities.length} moves verified on chain.`;
    this.queue.push(...activities);
    if (!this.timer) this.next();
  }

  private next() {
    const activity = this.queue.shift();
    if (!activity) {
      this.timer = undefined;
      return;
    }
    const target = this.destination();
    const rect = target.getBoundingClientRect();
    const mobile = window.innerWidth < 1100;
    const width = Math.min(302, window.innerWidth - 40);
    const x = mobile ? (window.innerWidth - width) / 2 : window.innerWidth * 0.35 - width / 2;
    const y = mobile ? 116 : Math.max(170, window.innerHeight * 0.36);
    const card = document.createElement('div');
    card.className = 'arkiv-arrival';
    card.style.cssText = `left:${x}px;top:${y}px;width:${width}px`;
    card.innerHTML =
      '<span class="arkiv-arrival-seal">✓</span><div><span class="arkiv-arrival-kicker">ARKIV / RECEIPT RECEIVED</span><strong>Move verified.</strong><span class="arkiv-arrival-label"></span></div><span class="arkiv-arrival-spark">✦</span>';
    card.querySelector('.arkiv-arrival-label')!.textContent = activity.label;
    card.dataset.activityId = activity.id;
    this.root.append(card);
    const dx = rect.left + rect.width / 2 - x - width / 2;
    const dy = rect.top + rect.height / 2 - y - card.offsetHeight / 2;
    const reduced = this.reduced.matches;
    const animation = card.animate(
      reduced
        ? [
            { opacity: 0 },
            { opacity: 1, offset: 0.15 },
            { opacity: 1, offset: 0.8 },
            { opacity: 0 },
          ]
        : [
            {
              opacity: 0,
              transform: 'translate(-130px, 48px) scale(.75) rotate(-9deg)',
              filter: 'blur(9px)',
            },
            {
              opacity: 1,
              transform: 'translate(0, 0) scale(1) rotate(0)',
              filter: 'blur(0)',
              offset: 0.24,
            },
            {
              opacity: 1,
              transform: 'translate(0, -8px) scale(1) rotate(0)',
              filter: 'blur(0)',
              offset: 0.64,
            },
            {
              opacity: 0,
              transform: `translate(${dx}px, ${dy}px) scale(.08) rotate(12deg)`,
              filter: 'blur(3px)',
            },
          ],
      { duration: reduced ? 1700 : 2100, easing: 'cubic-bezier(.22,.68,.25,1)', fill: 'forwards' },
    );
    this.animations.add(animation);
    void animation.finished.then(
      () => {
        this.animations.delete(animation);
        card.remove();
        if (target.isConnected) {
          const pulse = target.animate(
            reduced
              ? [{ opacity: 0.65 }, { opacity: 1 }]
              : [
                  { filter: 'brightness(2)', boxShadow: '0 0 44px #aaffaa55' },
                  { filter: 'brightness(1)', boxShadow: '0 0 0 transparent' },
                ],
            { duration: 700, easing: 'ease-out' },
          );
          this.animations.add(pulse);
          void pulse.finished.then(
            () => this.animations.delete(pulse),
            () => {},
          );
        }
      },
      () => {},
    );
    this.timer = setTimeout(() => this.next(), reduced ? 1800 : 2250);
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.root.replaceChildren();
    this.announce.textContent = '';
  }

  destroy() {
    this.clear();
    this.root.remove();
    this.announce.remove();
  }
}
