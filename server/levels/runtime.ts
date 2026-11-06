import {AuthService} from '../auth/AuthService';
import {configuredArchive} from '../arkiv/config';
import {ArkivArchive} from '../arkiv/ArkivArchive';
import {LevelStore} from './LevelStore';
export async function levelRuntime(auth:AuthService){
  const archive=configuredArchive(),store=new LevelStore(auth.databasePath,archive);
  try{if(archive instanceof ArkivArchive)await archive.reconcilePending();await store.hydrate();return store;}
  catch{store.close();throw new Error('Arkiv catalog could not be loaded. Check configuration, connectivity and the archive journal. No seed transaction was sent.');}
}
