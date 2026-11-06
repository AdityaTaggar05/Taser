export type WorldLayer = 'switch' | 'beam' | 'solid' | 'actor' | 'wall' | 'effect' | 'label';
export const BACKDROP_DEPTH = -2_000_000;
export const FLOOR_DEPTH = -1_000_000;
export const REPLAY_DEPTH = -500_000;
const order: Record<WorldLayer, number> = {
  switch: 0,
  beam: 1,
  solid: 2,
  actor: 3,
  wall: 4,
  effect: 5,
  label: 6,
};
/** Sort by the ground position, never the sprite's top edge or image height.
 * Layer breaks same-position ties only; a foreground wall covers rear objects.
 */
export const worldDepth = (groundY: number, layer: WorldLayer) => groundY + order[layer] / 100;
