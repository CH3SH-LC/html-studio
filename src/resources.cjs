'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { parse } = require('parse5');
const { visit, editsApply, escapeAttribute } = require('./document.cjs');

const MIME = { '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg' };
const allowedExtensions = new Set(Object.keys(MIME).filter(x => !['.html','.htm','.json'].includes(x)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const within = (root, file) => { const r = path.relative(root, file); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };

function rewriteCSS(css, replacer) {
  const withUrls = css.replace(/url\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s)]+))\s*\)/gi, (full,a,b,c) => {
    const url = a ?? b ?? c;
    const changed = replacer(url);
    return changed === url ? full : `url("${changed.replaceAll('"','%22')}")`;
  });
  return withUrls.replace(/(@import\s+)(["'])([^"']+)\2/gi, (full,p,q,url) => `${p}${q}${replacer(url)}${q}`);
}
function rewriteSrcset(value, fn) {
  const candidates = [];
  let p = 0;
  while (p < value.length) {
    while (/[\s,]/.test(value[p] || '') && p < value.length) p++;
    const start = p;
    const data = value.slice(p,p+5).toLowerCase() === 'data:';
    while (p < value.length && !/\s/.test(value[p]) && (data || value[p] !== ',')) p++;
    let url = value.slice(start,p).replace(/,+$/,'');
    if (!url) break;
    let descriptor = '';
    while (p < value.length && value[p] !== ',') descriptor += value[p++];
    if (value[p] === ',') p++;
    candidates.push(fn(url) + descriptor);
  }
  return candidates.join(', ');
}
function rewriteHTML(html, base, ref, integrity) {
  const tree = parse(html, { sourceCodeLocationInfo:true });
  const changes = [];
  let effectiveBase = base;
  visit(tree, node => {
    if (node.tagName === 'base') {
      const href = node.attrs.find(a=>a.name === 'href')?.value;
      if (href) { try { effectiveBase = new URL(href, base).href; } catch {} }
      const loc = node.sourceCodeLocation;
      if (loc) changes.push({start:loc.startOffset,end:loc.endOffset,value:''});
    }
  });
  visit(tree, node => {
    if (!node.sourceCodeLocation || node.tagName === 'base') return;
    let localResource;
    for (const attr of node.attrs || []) {
      const loc = node.sourceCodeLocation.attrs?.[attr.name];
      if (!loc) continue;
      let value = attr.value;
      if (attr.name === 'style') value = rewriteCSS(value, url=>ref(url,effectiveBase));
      else if (attr.name === 'srcset') value = rewriteSrcset(value,url=>ref(url,effectiveBase));
      else if (['src','poster'].includes(attr.name) || (attr.name === 'href' && node.tagName === 'link')) {value = ref(value,effectiveBase);if(['script','link'].includes(node.tagName))localResource=value;}
      else if (attr.name === 'href' && node.namespaceURI?.includes('svg')) value = value.startsWith('#') ? value : ref(value,effectiveBase);
      if (value !== attr.value) changes.push({start:loc.startOffset,end:loc.endOffset,value:`${attr.name}="${escapeAttribute(value)}"`});
    }
    const sri=node.attrs?.find(attr=>attr.name==='integrity');
    if(sri&&localResource&&integrity){const updated=integrity(localResource,sri.value);const location=node.sourceCodeLocation.attrs.integrity;if(updated!==sri.value)changes.push({start:location.startOffset,end:location.endOffset,value:`integrity="${escapeAttribute(updated)}"`});}
    if (node.tagName === 'style' && node.sourceCodeLocation.endTag) {
      const start = node.sourceCodeLocation.startTag.endOffset;
      const end = node.sourceCodeLocation.endTag.startOffset;
      const before = html.slice(start,end);
      const after = rewriteCSS(before,url=>ref(url,effectiveBase));
      if (after !== before) changes.push({start,end,value:after});
    }
  });
  return editsApply(html,changes);
}

class AssetGraph {
  constructor(file, token) {
    this.file = file; this.root = fs.existsSync(path.dirname(file)) ? fs.realpathSync(path.dirname(file)) : path.resolve(path.dirname(file)); this.token = token;
    this.approvedRoots = [this.root]; this.fallback = null;
    this.assets = new Map(); this.missing = new Set(); this.remote = new Set(); this.exportFiles = new Map();
    this.embeddedReferences = new Set();
  }
  approveFolder(folder) {
    this.fallback = fs.realpathSync(folder);
    this.approvedRoots.push(this.fallback); this.assets.clear(); this.missing.clear();
  }
  resetReport() { this.missing.clear(); this.remote.clear(); }
  resolve(raw, base) {
    const url = String(raw).trim();
    if(this.embeddedReferences.has(url.split(/[?#]/)[0]))return {unchanged:true,url};
    if (!url || /^(data:|blob:|#)/i.test(url)) return { unchanged:true, url };
    let full;
    try { full = /^[a-z]:[\\/]/i.test(url) ? pathToFileURL(url) : new URL(url, base); } catch { return { unchanged:true, url }; }
    if (/^https?:$/.test(full.protocol)) { this.remote.add(full.href); return { unchanged:true, url:full.href }; }
    if (full.protocol !== 'file:') return { unchanged:true, url };
    let file;
    try { file = fileURLToPath(full); } catch { return { unchanged:true,url }; }
    const allowed = candidate => {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
      const real = fs.realpathSync(candidate);
      return this.approvedRoots.some(root=>within(root,real)) && allowedExtensions.has(path.extname(real).toLowerCase());
    };
    if (!allowed(file) && this.fallback) {
      const relative = path.relative(this.root,file);
      const candidates = [path.join(this.fallback,relative),path.join(this.fallback,path.basename(file))];
      file = candidates.find(allowed) || file;
    }
    if (!allowed(file)) { this.missing.add(raw); return { missing:true, url }; }
    return { file:fs.realpathSync(file), suffix:full.search+full.hash };
  }
  assetName(file) { return `${hash(file).slice(0,12)}-${path.basename(file).replace(/[^\p{L}\p{N}._-]/gu,'_')}`; }
  previewReference(raw, base) {
    const result = this.resolve(raw,base);
    if (result.unchanged) return result.url;
    if (result.missing) return `studio-doc://${this.token}/missing/${encodeURIComponent(raw)}`;
    const name = this.assetName(result.file);
    if (!this.assets.has(name)) {
      if (this.assets.size > 4000 || fs.statSync(result.file).size > 200*1024*1024) { this.missing.add(raw); return ''; }
      this.assets.set(name,{ pending:true, file:result.file });
      let bytes = fs.readFileSync(result.file);
      if (path.extname(result.file).toLowerCase() === '.css') bytes = Buffer.from(rewriteCSS(bytes.toString('utf8'),url=>this.previewReference(url,pathToFileURL(result.file).href)));
      this.assets.set(name,{bytes,mime:MIME[path.extname(result.file).toLowerCase()]||'application/octet-stream',file:result.file});
    }
    return `studio-doc://${this.token}/assets/${encodeURIComponent(name)}${result.suffix}`;
  }
  integrity(url,before,exporting=false){
    let name;try{name=decodeURIComponent(new URL(url,'https://bundle.invalid/').pathname.split('/').pop());}catch{return before;}
    const bytes=exporting?this.exportFiles.get(name):this.assets.get(name)?.bytes;if(!bytes)return before;
    const algorithms=before.split(/\s+/).map(item=>item.split('-')[0]).filter(name=>['sha256','sha384','sha512'].includes(name));
    return algorithms.length?algorithms.map(name=>name+'-'+crypto.createHash(name).update(bytes).digest('base64')).join(' '):before;
  }
  preview(html) { return rewriteHTML(html,pathToFileURL(this.file).href,(url,base)=>this.previewReference(url,base),(url,sri)=>this.integrity(url,sri)); }
  export(html, target) {
    this.exportFiles = new Map();
    if (path.resolve(path.dirname(target)).toLowerCase() === path.resolve(this.root).toLowerCase() && !this.fallback) return {html,files:[],folder:null};
    const stem = path.basename(target,path.extname(target));
    let folder = '__HTML_STUDIO_ASSETS__';
    const reference = (raw,base,css=false) => {
      const result = this.resolve(raw,base);
      if (result.unchanged) return result.url;
      if (result.missing) throw new Error(`素材未找到：${raw}。请先定位素材文件夹，或保存到原稿所在目录。`);
      const name = this.assetName(result.file);
      if (!this.exportFiles.has(name)) {
        this.exportFiles.set(name,null);
        let bytes = fs.readFileSync(result.file);
        if (path.extname(result.file).toLowerCase() === '.css') bytes = Buffer.from(rewriteCSS(bytes.toString('utf8'),url=>reference(url,pathToFileURL(result.file).href,true)));
        this.exportFiles.set(name,bytes);
      }
      const relative = (css ? '' : encodeURIComponent(folder)+'/') + encodeURIComponent(name);
      return relative + result.suffix;
    };
    let output = rewriteHTML(html,pathToFileURL(this.file).href,(url,base)=>reference(url,base),(url,sri)=>this.integrity(url,sri,true));
    const digest=hash(html+[...this.exportFiles.values()].map(bytes=>hash(bytes||Buffer.alloc(0))).join(''));
    folder=`${stem}-素材-${digest.slice(0,10)}`;
    output=output.replaceAll('__HTML_STUDIO_ASSETS__',encodeURIComponent(folder));
    return {html:output,folder:this.exportFiles.size ? folder : null,files:[...this.exportFiles].map(([name,bytes])=>({name,bytes}))};
  }
  report() { return {missing:[...this.missing],remote:[...this.remote]}; }
}

module.exports = { AssetGraph, MIME, hash, within, rewriteCSS, rewriteHTML, rewriteSrcset };
