import { AuthService } from '../auth/AuthService';
import { configuredArchive } from '../arkiv/config';
import { ArkivArchive } from '../arkiv/ArkivArchive';
import { ArchiveError } from '../arkiv/archive';
import { LevelError, LevelStore } from './LevelStore';
import { configuredRegistry } from '../certification/Registry';
export async function levelRuntime(auth: AuthService) {
  const registry = configuredRegistry();
  let store: LevelStore;
  try {
    store = new LevelStore(auth.databasePath, configuredArchive(), registry);
  } catch (error) {
    registry.close?.();
    throw error;
  }
  const archive = store.archive;
  try {
    if (archive instanceof ArkivArchive) await archive.reconcilePending();
    await store.hydrate();
    return store;
  } catch (error) {
    store.close();
    if (error instanceof ArchiveError || error instanceof LevelError) throw error;
    throw new Error(
      'Archived catalog or CRE certificates could not be verified. Check Arkiv/CRE configuration, connectivity and the archive journal. No seed transaction was sent.',
    );
  }
}
