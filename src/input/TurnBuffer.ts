import type { Direction } from '../core/types';
export class TurnBuffer {
  pending: [Direction | null, Direction | null] = [null,null];
  constructor(
    private commit: (a: Direction,b: Direction) => void,
    private changed: () => void,
    private canQueue: (player: 1 | 2, direction: Direction) => boolean = () => true,
  ) {}
  queue(player: 1 | 2, direction: Direction) {
    // An invalid replacement must preserve both players' existing valid selections.
    if (!this.canQueue(player, direction)) return false;
    this.pending[player-1] = direction;
    this.changed();
    if (this.pending[0] && this.pending[1]) {
      const [a,b] = this.pending as [Direction,Direction];
      this.pending = [null,null]; this.commit(a,b); this.changed();
    }
    return true;
  }
  clear() { this.pending = [null,null]; this.changed(); }
}
export const KEY_MOVES: Record<string,[1|2,Direction]> = {
  KeyW:[1,'U'], KeyS:[1,'D'], KeyA:[1,'L'], KeyD:[1,'R'], Space:[1,'W'],
  ArrowUp:[2,'U'], ArrowDown:[2,'D'], ArrowLeft:[2,'L'], ArrowRight:[2,'R'], Enter:[2,'W'],
};
