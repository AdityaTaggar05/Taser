import type { Coord, Direction } from '../core/types';
import type { SessionState } from '../network/protocol';
const arrows: Record<Direction, string> = { U: '↑', D: '↓', L: '←', R: '→', W: 'Wait' };
const coord = (point: Coord) => `(${point[0]}, ${point[1]})`;

export class PositionHistory {
  readonly root = document.createElement('details');
  private body = document.createElement('div');
  private signature = '';
  constructor(private inspect: (step: number) => void) {
    this.root.className = 'position-history';
    this.root.open = false;
    const summary = document.createElement('summary');
    summary.textContent = 'Inspect positions through time';
    const note = document.createElement('p');
    note.textContent =
      'Every committed turn. Both players, every block. Select a turn to revisit it.';
    this.body.className = 'position-history-scroll';
    this.root.append(summary, note, this.body);
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
      return;
    }
    const frames = session.positionHistory ?? [];
    const total = session.level?.totalSteps ?? 8;
    const signature = JSON.stringify([frames, selected, total]);
    if (signature === this.signature) return;
    this.signature = signature;
    const table = document.createElement('table');
    table.setAttribute('aria-label', 'Both players and block positions at every recorded time');
    const head = table.createTHead().insertRow();
    for (const label of ['Turn', 'P1 · forward', 'P2 · backward']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      head.append(th);
    }
    const body = table.createTBody();
    for (const frame of frames) {
      const row = body.insertRow();
      row.dataset.positionStep = String(frame.step);
      row.classList.toggle('current', frame.step === selected);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.reviewStep = String(frame.step);
      button.textContent = String(frame.step).padStart(2, '0');
      button.setAttribute('aria-label', `Review positions at turn ${frame.step}`);
      button.setAttribute('aria-current', String(frame.step === selected));
      row.insertCell().append(button);
      for (const player of [1, 2] as const) {
        const cell = row.insertCell();
        cell.className = `position-player p${player}`;
        const time = document.createElement('strong');
        time.textContent = `t = ${player === 1 ? frame.step : total - frame.step}${frame.inputs ? ' · ' + arrows[frame.inputs[player - 1]] : ' · Start'}`;
        cell.append(time);
        const operator = document.createElement('span');
        operator.textContent = `Player ${coord(player === 1 ? frame.p1Pos : frame.p2Pos)}`;
        cell.append(operator);
        const boxes = player === 1 ? frame.boxesP1 : frame.boxesP2;
        boxes.forEach((position, index) => {
          const block = document.createElement('span');
          block.textContent = `B${index + 1} ${coord(position)}`;
          cell.append(block);
        });
        if (!boxes.length) {
          const empty = document.createElement('span');
          empty.textContent = 'No blocks';
          cell.append(empty);
        }
      }
    }
    if (!frames.length) {
      const note = document.createElement('p');
      note.textContent = 'Waiting for committed position history…';
      this.body.replaceChildren(note);
    } else this.body.replaceChildren(table);
  }
}
