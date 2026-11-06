import type {AuthClient} from '../auth/AuthClient';
import type {LevelConfig} from '../core/types';
import type {LevelSummary,StoredLevel} from './types';
export class LevelClient {
  constructor(private auth:AuthClient){}
  async mine(){return (await this.auth.levelRequest<{levels:LevelSummary[]}>()).levels;}
  async community(){return (await this.auth.levelRequest<{levels:LevelSummary[]}>('/community')).levels;}
  get(id:string){return this.auth.levelRequest<StoredLevel>('/'+id);}
  save(level:LevelConfig,id?:string,revision?:number){return this.auth.levelRequest<StoredLevel>(id?'/'+id:'',{level,revision});}
  publish(id:string,revision:number){return this.auth.levelRequest<StoredLevel>(`/${id}/publish`,{revision});}
}
