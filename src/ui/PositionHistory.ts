import type { SessionState } from '../network/protocol';

/** Uses the existing role-filtered projection; never requests partner positions. */
export class PositionHistory {
  readonly root = document.createElement('details');
  private body = document.createElement('div');
  private signature = '';
  constructor(private inspect: (step: number) => void) {
    this.root.className = 'position-history';
    const summary = document.createElement('summary');
    summary.textContent = 'Your timeline';
    this.body.className = 'position-history-scroll';
    this.root.append(summary, this.body);
    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-review-step]');
      if (button) this.inspect(Number(button.dataset.reviewStep));
    });
  }
  render(session: SessionState | undefined, selected: number) {
    this.root.hidden = !session;
    if (!session) {
      this.signature = '';
      this.body.replaceChildren();
      this.root.open = false;
      return;
    }
    const signature = JSON.stringify([session.history, session.level, session.player, selected]);
    if (signature === this.signature) return;
    this.signature = signature;
    const frame =
      session.history.find((frame) => frame.step === selected) ?? session.history.at(-1);
    const level = session.level;
    if (!frame || !level) return;
    const focusedStep = (document.activeElement as HTMLElement)?.dataset.reviewStep;
    const map = document.createElement('div');
    map.className = 'position-map';
    const cells: string[] = [];
    for (const [x, y] of level.walls)
      cells.push(
        `<rect x="${x - 1}" y="${level.height - y}" width="1" height="1" class="position-wall"/>`,
      );
    for (const [x, y] of frame.boxes)
      cells.push(
        `<rect x="${x - 0.85}" y="${level.height - y + 0.15}" width=".7" height=".7" class="position-block"/>`,
      );
    cells.push(
      `<circle cx="${frame.position[0] - 0.5}" cy="${level.height - frame.position[1] + 0.5}" r=".3" class="position-operator"/>`,
    );
    map.innerHTML = `<svg viewBox="0 0 ${level.width} ${level.height}" role="img" aria-label="Your operator and blocks at turn ${frame.step}">${cells.join('')}</svg>`;
    const rail = document.createElement('nav');
    rail.setAttribute('aria-label', 'Review your timeline');
    for (const frame of session.history) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.reviewStep = String(frame.step);
      button.textContent = `T${String(session.player === 2 ? level.totalSteps - frame.step : frame.step).padStart(2, '0')}`;
      button.setAttribute('aria-label', `Review your turn ${frame.step}`);
      button.setAttribute('aria-current', String(frame.step === selected));
      rail.append(button);
    }
    this.body.replaceChildren(map, rail);
    if (focusedStep)
      this.body
        .querySelector<HTMLButtonElement>(`[data-review-step="${Number(focusedStep)}"]`)
        ?.focus({ preventScroll: true });
  }
}
