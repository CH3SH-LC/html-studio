'use strict';
// Read the declarative data in an exported HTML bundle, never execute its loader
// in the editor. Saving replaces only the JSON template inside the original file.
const {parse}=require('parse5');
const {gunzipSync}=require('node:zlib');
const {SourceDocument,visit}=require('./document.cjs');
const {rewriteHTML}=require('./resources.cjs');
const LIMIT=40*1024*1024;
function readBundle(text){
  if(!text.includes('__bundler/template'))return null;
  const entries=new Map();
  visit(parse(text,{sourceCodeLocationInfo:true}),node=>{
    if(node.tagName!=='script')return;
    const type=node.attrs.find(a=>a.name==='type')?.value;
    if(type?.startsWith('__bundler/')){
      if(entries.has(type))throw new Error('文稿内的封装数据重复，请从生成工具重新导出 HTML。');
      entries.set(type,node);
    }
  });
  if(!entries.has('__bundler/template'))return null;
  try{
    const templateNode=entries.get('__bundler/template'),loc=templateNode.sourceCodeLocation;
    const json=node=>JSON.parse((node?.childNodes||[]).map(c=>c.value||'').join(''));
    const template=json(templateNode),manifest=json(entries.get('__bundler/manifest'));
    if(typeof template!=='string'||Buffer.byteLength(template)>LIMIT||!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('invalid bundle');
    const assets=new Map();let total=Buffer.byteLength(template);
    if(Object.keys(manifest).length>4000)throw new Error('too many assets');
    for(const [id,entry]of Object.entries(manifest)){
      if(!/^[a-f\d-]{36}$/i.test(id)||typeof entry?.data!=='string'||typeof entry.mime!=='string'||!/^[-\w.+]+\/[-\w.+]+(?:;[\w= -]+)?$/.test(entry.mime))throw new Error('invalid asset');
      let bytes=Buffer.from(entry.data,'base64');
      if(entry.compressed)bytes=gunzipSync(bytes,{maxOutputLength:LIMIT-total});
      total+=bytes.length;if(total>LIMIT)throw new Error('bundle too large');
      assets.set(id,{bytes,mime:entry.mime});
    }
    return {original:text,template,start:loc.startTag.endOffset,end:loc.endTag.startOffset,assets};
  }catch{throw new Error('文稿的封装数据不完整、已损坏或解压后超过 40 MB，请重新导出 HTML。');}
}
class BundledDocument extends SourceDocument{
  constructor(bundle){super(bundle.template);this.bundle=bundle;}
  // x-dc parses inline CSS into component style objects. Those objects cannot
  // express !important; retaining it would silently drop edited dimensions.
  get stylePriority(){return /<x-dc\b/i.test(this.bundle.template)?'':'important';}
  content(){return super.clean();}
  wrap(template){
    const b=this.bundle;if(template===b.template)return b.original;
    const json=JSON.stringify(template).replaceAll('<','\\u003c');
    return b.original.slice(0,b.start)+'\n'+json+'\n  '+b.original.slice(b.end);
  }
  clean(){return this.wrap(this.content());}
  presentationHTML(){return this.wrap(this.source);}
  editingHTML(){
    return rewriteHTML(super.editingHTML(),'https://bundle.invalid/',url=>{
      const asset=this.bundle.assets.get(url.split(/[?#]/)[0]);
      return asset?`data:${asset.mime};base64,${asset.bytes.toString('base64')}`:url;
    });
  }
}
function openDocument(text){const bundle=readBundle(text);return bundle?new BundledDocument(bundle):new SourceDocument(text);}
module.exports={readBundle,openDocument,BundledDocument};
