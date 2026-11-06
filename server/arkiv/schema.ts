import { defineSchema, str, u64, bytes } from '@arkiv-network/sdk/schema';
export const LevelEntities = defineSchema('weldpoint_levels_v1', {
  namespace: str().indexed(),
  record_id: str().indexed(),
  revision: u64().indexed(),
  category: str().indexed(),
  content_type: str(),
  ciphertext: bytes(),
});
