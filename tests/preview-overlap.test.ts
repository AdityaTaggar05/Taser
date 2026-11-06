import {it,expect} from 'vitest';
import {PreviewOverlapCycle} from '../src/render/PreviewOverlapCycle';
const visual=()=>({visible:true,setVisible(value:boolean){this.visible=value;}});
it('alternates a plate and opposite-role block at one-second boundaries while leaving other tiles steady',()=>{
  const cycle=new PreviewOverlapCycle(),plate=visual(),block=visual(),player=visual();
  cycle.add([3,4],plate);cycle.add([3,4],block);cycle.add([2,4],player);
  cycle.show(0);expect([plate.visible,block.visible,player.visible]).toEqual([true,false,true]);
  cycle.show(.999);expect([plate.visible,block.visible,player.visible]).toEqual([true,false,true]);
  cycle.show(1);expect([plate.visible,block.visible,player.visible]).toEqual([false,true,true]);
  cycle.show(2);expect([plate.visible,block.visible,player.visible]).toEqual([true,false,true]);
});
it('cycles all occupants of each tile independently and keeps entity decorations together',()=>{
  const cycle=new PreviewOverlapCycle(),plate=visual(),block=visual(),label=visual(),player=visual(),exit1=visual(),exit2=visual();
  cycle.add([1,1],plate);cycle.add([1,1],block,label);cycle.add([1,1],player);cycle.add([2,2],exit1);cycle.add([2,2],exit2);
  for(let second=0;second<10;second++){
    cycle.show(second);
    expect([plate.visible,block.visible,player.visible]).toEqual([second%3===0,second%3===1,second%3===2]);
    expect(label.visible).toBe(block.visible);expect([exit1.visible,exit2.visible]).toEqual([second%2===0,second%2===1]);
  }
});
it('restores the countdown phase after a redraw or reconnect without replaying earlier occupants',()=>{
  const cycle=new PreviewOverlapCycle(),a=visual(),b=visual(),c=visual();cycle.add([4,2],a);cycle.add([4,2],b);cycle.add([4,2],c);
  cycle.show(7);expect([a.visible,b.visible,c.visible]).toEqual([false,true,false]);
  cycle.show(0);expect([a.visible,b.visible,c.visible]).toEqual([true,false,false]);
});
