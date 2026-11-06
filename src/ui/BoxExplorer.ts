import type { SessionState } from '../network/protocol';
/** History uses only the authenticated operator's server projection. */
export class BoxExplorer {
  private signature = '';
  readonly root = document.createElement('section');
  constructor(
    parent: Element,
    private inspect: (step: number | null) => void,
  ) {
    this.root.className = 'box-explorer';
    this.root.setAttribute('aria-label', 'Box position explorer');
    parent.append(this.root);
  }
  update(session: SessionState | null, selected: number | null) {
    const signature = JSON.stringify([session?.history, session?.player, selected]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'box-heading';
    const title = document.createElement('b');
    title.textContent = 'BOX POSITION EXPLORER';
    const caption = document.createElement('span');
    caption.textContent = session
      ? `P${session.player} · select a recorded turn`
      : 'Waiting for chamber';
    head.append(title, caption);
    this.root.append(head);
    if (!session?.level) return;
    const history = document.createElement('div');
    history.className = 'box-snapshots';
    history.setAttribute('aria-label', 'Box states by turn');
    const current = selected ?? session.history.at(-1)?.step;
    for (const frame of session.history) {
      const button = document.createElement('button');
      button.className = 'box-snapshot';
      button.setAttribute('aria-pressed', String(frame.step === current));
      button.onclick = () =>
        this.inspect(frame.step === session.history.at(-1)?.step ? null : frame.step);
      const title = document.createElement('b');
      title.textContent = `T${String(frame.step).padStart(2, '0')}`;
      const coordinates = frame.boxes.map((p, i) => `B${i + 1}: (${p[0]}, ${p[1]})`).join(' · ');
      button.setAttribute('aria-label', `Turn ${frame.step}. ${coordinates || 'No boxes'}`);
      const grid = document.createElement('span');
      grid.className = 'box-mini-grid';
      grid.style.gridTemplateColumns = `repeat(${session.level.width}, 1fr)`;
      grid.style.aspectRatio = String(session.level.width / session.level.height);
      for (let y = session.level.height; y >= 1; y--)
        for (let x = 1; x <= session.level.width; x++) {
          const cell = document.createElement('i');
          const box = frame.boxes.findIndex((p) => p[0] === x && p[1] === y);
          if (box >= 0) {
            cell.className = 'occupied';
            cell.textContent = String(box + 1);
          }
          grid.append(cell);
        }
      const coord = document.createElement('small');
      coord.textContent = coordinates || 'No boxes';
      button.append(title, grid, coord);
      history.append(button);
    }
    this.root.append(history);
    history
      .querySelector('[aria-pressed=true]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
