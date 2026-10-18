'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {openDocument,readBundle}=require('../src/bundled-document.cjs');
const original=fs.readFileSync(path.join(__dirname,'../research/real-decks/slide-md/docs/SLIDE-md/SLIDE-md-gemini-color-system/sample.html'),'utf8');
test('real published bundle reads six source pages and preserves all untouched bytes',()=>{
  const doc=openDocument(original);assert.ok(doc.bundle);assert.equal([...doc.nodes.values()].filter(n=>n.tagName==='section').length,6);assert.equal(doc.clean(),original);
  const html=doc.editingHTML();assert.match(html,/data:font\/woff2;base64,/);assert.match(html,/data:image\/svg\+xml;base64,/);assert.ok(!/<script\b/i.test(html));assert.ok(!html.includes('Unpacking...'));
});
test('bundle edits round trip through JSON with original loader and compressed assets intact',()=>{
  const doc=openDocument(original),id=[...doc.nodes].find(([,n])=>n.tagName==='h1')[0];
  doc.apply({id,kind:'inner',html:'中文 &amp; "引号" <em>细节</em> <script>notExecuted()</script>'});
  const output=doc.clean(),saved=readBundle(output),before=readBundle(original);
  assert.equal(output.slice(0,before.start),original.slice(0,before.start));assert.equal(output.slice(output.lastIndexOf('</script>')),original.slice(original.lastIndexOf('</script>')));
  assert.ok(saved.template.includes('中文 &amp; "引号"'));assert.equal(openDocument(output).clean(),output);assert.equal(saved.assets.size,before.assets.size);
  for(const [id,a]of before.assets)assert.deepEqual(saved.assets.get(id),a);
  assert.ok(!/data-hs-[a-f\d]{12}/.test(output));
});
test('bundle malformed JSON is rejected without evaluating JavaScript',()=>{
  assert.throws(()=>openDocument(original.replace('"compressed":true','"compressed":NOT_JSON')),/封装数据/);
  const ordinary='<!doctype html><html><body><h1>普通稿</h1><script>throw new Error("no")</script></body></html>';
  assert.equal(openDocument(ordinary).clean(),ordinary);
});
