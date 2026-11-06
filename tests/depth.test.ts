import { describe, it, expect } from 'vitest';
import { FLOOR_DEPTH, REPLAY_DEPTH, worldDepth } from '../src/render/depth';
describe('top-down occlusion', () => {
  it('foreground walls cover boxes, switches and operators behind them', () => {
    const rearY = 320,
      frontY = 432;
    for (const kind of ['solid', 'switch', 'actor'] as const) {
      expect(worldDepth(frontY, 'wall')).toBeGreaterThan(worldDepth(rearY, kind));
      expect(worldDepth(rearY, 'wall')).toBeLessThan(worldDepth(frontY, kind));
    }
  });
  it('keeps switches below boxes and walls within a cell, with floor overlays under solids', () => {
    const y = 320;
    expect(FLOOR_DEPTH).toBeLessThan(REPLAY_DEPTH);
    expect(REPLAY_DEPTH).toBeLessThan(worldDepth(y, 'switch'));
    expect(worldDepth(y, 'switch')).toBeLessThan(worldDepth(y, 'solid'));
    expect(worldDepth(y, 'solid')).toBeLessThan(worldDepth(y, 'wall'));
  });
});
