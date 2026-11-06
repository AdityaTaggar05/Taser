import { it, expect } from 'vitest';
import { remainingLifetime } from '../src/ui/Leaderboards';

it('counts down from actual chain blocks and waits for chain confirmation at zero', () => {
  const expiry = { expiresAt: '5500', currentBlock: '100', observedAt: 0, blockSeconds: 2 };
  expect(remainingLifetime(expiry, 0)).toBe('Estimated time left 3h 00m 00s');
  expect(remainingLifetime(expiry, 61_000)).toBe('Estimated time left 2h 58m 59s');
  expect(remainingLifetime(expiry, 10_800_000)).toBe('Checking chain expiration…');
  expect(remainingLifetime({ ...expiry, currentBlock: '5501' }, 0)).toBe(
    'Checking chain expiration…',
  );
});
