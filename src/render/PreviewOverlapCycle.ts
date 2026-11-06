import type {Coord} from '../core/types';
export interface PreviewVisual {setVisible(visible:boolean):unknown}
/** One full-size entity per shared tile, advancing with the study countdown. */
export class PreviewOverlapCycle {
  private cells=new Map<string,PreviewVisual[][]>();
  private second=-1;
  add(pos:Coord,...visuals:PreviewVisual[]){
    const key=pos.join(','),entities=this.cells.get(key)??[];
    entities.push(visuals);this.cells.set(key,entities);
  }
  show(elapsedSeconds:number){
    const second=Math.max(0,Math.floor(elapsedSeconds));if(second===this.second)return;this.second=second;
    for(const entities of this.cells.values())entities.forEach((visuals,index)=>{
      const visible=index===second%entities.length;for(const visual of visuals)visual.setVisible(visible);
    });
  }
}
