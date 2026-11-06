import { ExpirationTime } from '@arkiv-network/sdk';
import type { ArchiveWrite } from './archive';

export const LEVEL_BASE_TTL = ExpirationTime.fromHours(2);
export const HEART_EXTENSION = ExpirationTime.fromHours(1);
export const RUN_TTL = ExpirationTime.fromDays(2);
// SDK 1.0.1 converts time helpers using this nominal block duration.
export const ARKIV_BLOCK_SECONDS = 2;

export function creationExpiration(record: ArchiveWrite) {
  if (record.category === 'community' || record.category === 'campaign') return LEVEL_BASE_TTL;
  return record.category === 'run' || record.category === 'move' ? RUN_TTL : ExpirationTime.max();
}
