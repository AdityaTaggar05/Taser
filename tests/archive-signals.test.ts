import { describe, expect, it } from 'vitest';
import { VerificationSignals } from '../src/ui/ArchiveSignal';
import type { ArkivActivity, ArkivFeed } from '../src/network/arkiv';

const move = (id: string, state: ArkivActivity['state'] = 'confirmed'): ArkivActivity => ({
  id,
  kind: 'move',
  label: `Turn ${id}`,
  createdAt: 100,
  state,
  txHash: '0x' + 'ab'.repeat(32),
  entityKey: '0x' + 'cd'.repeat(32),
});
const feed = (activities: ArkivActivity[], storage: ArkivFeed['storage'] = 'arkiv'): ArkivFeed => ({
  activities,
  storage,
});

describe('verified move arrivals', () => {
  it('loads historical receipts quietly and celebrates a pending move exactly once', () => {
    const signals = new VerificationSignals();
    expect(signals.receive(feed([move('old'), move('new', 'pending')]))).toEqual([]);
    expect(signals.receive(feed([move('new'), move('old')]))).toEqual([move('new')]);
    expect(signals.receive(feed([move('new'), move('old')]))).toEqual([]);
    expect(signals.receive(feed([]))).toEqual([]);
    expect(signals.receive(feed([move('new')]))).toEqual([]);
  });

  it('catches receipts that confirm between polls, in chronological feed order', () => {
    const signals = new VerificationSignals();
    signals.receive(feed([]));
    expect(signals.receive(feed([move('second'), move('first')]))).toEqual([
      move('first'), move('second'),
    ]);
  });

  it('requires a real-chain confirmed move and both valid chain references', () => {
    const signals = new VerificationSignals();
    signals.receive(feed([]));
    expect(signals.receive(feed([
      move('pending', 'pending'), move('failed', 'failed'),
      { ...move('run'), kind: 'run' },
      { ...move('no-tx'), txHash: undefined },
      { ...move('bad-entity'), entityKey: '0x123' },
    ]))).toEqual([]);
    expect(signals.receive(feed([move('pending')]))).toEqual([move('pending')]);
  });

  it('never presents test or unconfigured storage as chain verification', () => {
    const signals = new VerificationSignals();
    for (const storage of ['test', 'unconfigured'] as const) {
      signals.receive(feed([], storage));
      expect(signals.receive(feed([move('test')], storage))).toEqual([]);
    }
    // Changing sources seeds historical records instead of replaying a backlog.
    expect(signals.receive(feed([move('test')]))).toEqual([]);
    expect(signals.receive(feed([move('real'), move('test')]))).toEqual([move('real')]);
  });

  it('silently consumes receipts caught up after a hidden tab or screen', () => {
    const signals = new VerificationSignals();
    signals.receive(feed([]));
    expect(signals.receive(feed([move('background')]), true)).toEqual([]);
    expect(signals.receive(feed([move('background')]))).toEqual([]);
    expect(signals.receive(feed([move('foreground')]))).toEqual([move('foreground')]);
  });

  it('resets receipt history at account boundaries', () => {
    const signals = new VerificationSignals();
    signals.receive(feed([]));
    expect(signals.receive(feed([move('a')]))).toHaveLength(1);
    signals.reset();
    expect(signals.receive(feed([move('b')]))).toEqual([]);
    expect(signals.receive(feed([move('new-b')]))).toEqual([move('new-b')]);
  });
});
