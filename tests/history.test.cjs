const test=require('node:test'),assert=require('node:assert/strict');
const {SourceHistory}=require('../src/history.cjs');
const {editsApply}=require('../src/document.cjs');
test('source history preserves 100 edits without duplicating embedded image payloads',()=>{
  const image='x'.repeat(4*1024*1024);let source='<img src="data:image/png;base64,'+image+'"><p>0</p>';
  const original=source,history=new SourceHistory();
  for(let i=1;i<=110;i++){const next=source.replace(/<p>\d+<\/p>/,`<p>${i}</p>`);history.push(source,next,{page:i%4});source=next;}
  assert.ok(JSON.stringify(history.entries).length<20000);
  for(let i=0;i<110;i++)source=history.move(source,'undo').source;
  assert.equal(source,original);assert.equal(history.canUndo,false);
  for(let i=0;i<110;i++)source=history.move(source,'redo').source;
  assert.ok(source.endsWith('<p>110</p>'));
});
test('saving seals text merge and undo returns exactly to saved content',()=>{
  const h=new SourceHistory();h.push('A','AB',{merge:'text',page:0});h.push('AB','ABC',{merge:'text',page:0});assert.equal(h.entries.length,1);
  h.seal();h.push('ABC','ABCD',{merge:'text',page:1});assert.equal(h.entries.length,2);
  let r=h.move('ABCD','undo');assert.equal(r.source,'ABC');assert.equal(r.page,1);
  h.push(r.source,'ABCE',{merge:'text',page:0});assert.equal(h.canRedo,false);assert.equal(h.move('ABCE','undo').source,'ABC');
});
test('many localized source edits preserve untouched bytes and reject overlap',()=>{
  const source=Array.from({length:5000},(_,i)=>`<i>${i}</i>`).join('');const edits=[];
  for(let i=0;i<source.length;i++)if(source[i]==='>')edits.push({start:i,end:i+1,value:'> '});
  assert.equal(editsApply(source,edits),source.replaceAll('>','> '));
  assert.throws(()=>editsApply('abcdef',[{start:1,end:4,value:'x'},{start:3,end:5,value:'y'}]));
});
