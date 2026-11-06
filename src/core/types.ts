export type Direction = 'U' | 'D' | 'L' | 'R' | 'W';
export type Coord = [number, number];
export type GameStatus =
  | 'PLAYING_PHASE_1'
  | 'WELD_SUCCESS'
  | 'PLAYING_PHASE_2'
  | 'PARADOX_WELD'
  | 'PARADOX_COLLISION'
  | 'LASER_DEATH'
  | 'OUT_OF_TIME'
  | 'VICTORY';
export interface LevelConfig {
  id: number;
  name: string;
  subtitle: string;
  width: number;
  height: number;
  totalSteps: number;
  weldStep: number;
  walls: Coord[];
  iceTiles?: Coord[];
  weldTargets?: Coord[];
  midpointSwitchRequired?: Coord;
  switchesP1: Coord[];
  switchesP2: Coord[];
  laserEmitter?: { pos: Coord; dir: Direction };
  laserReceiverP1?: Coord;
  hasMirrorBox?: boolean;
  exitP1: Coord;
  exitP2: Coord;
  initialP1: Coord;
  initialP2: Coord;
  initialBoxesP1: Coord[];
  initialBoxesP2: Coord[];
  solutionP1: Direction[];
  solutionP2: Direction[];
  environment?: string;
}
export interface StepSnapshot {
  step: number;
  p1Pos: Coord;
  p2Pos: Coord;
  boxesP1: Coord[];
  boxesP2: Coord[];
  status: GameStatus;
  message: string;
}
export interface MoveResult {
  nextPlayer: Coord;
  nextBoxes: Coord[];
  shovedBoxIndex: number | null;
}
export const DIR_DELTA: Record<Direction, Coord> = {
  U: [0, 1],
  D: [0, -1],
  R: [1, 0],
  L: [-1, 0],
  W: [0, 0],
};
export const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
export const hasCoord = (list: Coord[] | undefined, c: Coord) =>
  !!list?.some((p) => sameCoord(p, c));
export const inBounds = (c: Coord, w: number, h: number) =>
  c[0] >= 1 && c[0] <= w && c[1] >= 1 && c[1] <= h;
export const copyBoxes = (boxes: Coord[]): Coord[] => boxes.map((c) => [...c]);
export const isLive = (status: GameStatus) =>
  ['PLAYING_PHASE_1', 'WELD_SUCCESS', 'PLAYING_PHASE_2'].includes(status);
