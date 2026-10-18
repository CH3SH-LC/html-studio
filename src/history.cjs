'use strict';
// Keep only the changed source range: an embedded image is not copied for each keystroke.
function difference(before, after) {
  let start=0, endBefore=before.length, endAfter=after.length;
  while(start<endBefore && start<endAfter && before[start]===after[start])start++;
  while(endBefore>start && endAfter>start && before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}
  return {start,removed:before.slice(start,endBefore),inserted:after.slice(start,endAfter)};
}
function apply(source,entry,reverse=false){
  const removed=reverse?entry.inserted:entry.removed,inserted=reverse?entry.removed:entry.inserted;
  if(source.slice(entry.start,entry.start+removed.length)!==removed)throw new Error('撤销状态不一致，当前修改仍保留。');
  return source.slice(0,entry.start)+inserted+source.slice(entry.start+removed.length);
}
class SourceHistory {
  constructor(limit=120){this.entries=[];this.index=0;this.limit=limit;}
  get canUndo(){return this.index>0;}
  get canRedo(){return this.index<this.entries.length;}
  seal(){if(this.canUndo)this.entries[this.index-1].merge=null;}
  push(before,after,meta={}){
    this.entries.length=this.index;
    const previous=this.entries[this.index-1],time=Date.now();
    if(meta.merge&&previous?.merge===meta.merge&&time-previous.time<1300){
      const original=apply(before,previous,true);
      this.entries[this.index-1]={...difference(original,after),...meta,time};
    }else{
      this.entries.push({...difference(before,after),...meta,time});
      if(this.entries.length>this.limit)this.entries.shift();
      this.index=this.entries.length;
    }
  }
  move(source,direction){
    const undo=direction==='undo';if(undo?!this.canUndo:!this.canRedo)return null;
    const entry=this.entries[undo?this.index-1:this.index];
    const result=apply(source,entry,undo);this.index+=undo?-1:1;this.seal();
    return {source:result,page:entry.page||0};
  }
}
module.exports={SourceHistory,difference,apply};
