import { expect, test } from 'vitest';
import { expirySeconds } from '../src/ui/LevelLibrary';

test('estimates expiry from block distance, including observation age', () => {
  const expiry = {
    currentBlock: '900719925474099200',
    expiresAt: '900719925474101000',
    blockSeconds: 2,
    observedAt: 10000,
  };
  expect(expirySeconds(expiry, 10000)).toBe(3600);
  expect(expirySeconds(expiry, 70000)).toBe(3540);
  // A client clock behind the observation must not extend the block estimate.
  expect(expirySeconds(expiry, 5000)).toBe(3600);
});

test('an elapsed estimate reaches zero without claiming chain-confirmed deletion', () => {
  expect(
    expirySeconds(
      { currentBlock: '100', expiresAt: '101', blockSeconds: 2, observedAt: 10000 },
      13000,
    ),
  ).toBe(0);
  expect(
    expirySeconds(
      { currentBlock: '102', expiresAt: '101', blockSeconds: 2, observedAt: 10000 },
      10000,
    ),
  ).toBe(0);
});
