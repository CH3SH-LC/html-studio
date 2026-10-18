'use strict';
const { parse } = require('parse5');
const crypto = require('node:crypto');

const escapeAttribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function visit(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) visit(child, callback);
  if (node.content) visit(node.content, callback);
}
function editsApply(source, edits) {
  const sorted = edits.filter(Boolean).sort((a, b) => a.start - b.start || a.end - b.end);
  let boundary = 0;
  const parts = [];
  for (const edit of sorted) {
    if (edit.start < boundary || edit.start < 0 || edit.end < edit.start || edit.end > source.length) throw new Error('修改范围重叠，原文件没有写入。');
    parts.push(source.slice(boundary, edit.start), edit.value);
    boundary = edit.end;
  }
  parts.push(source.slice(boundary));
  return parts.join('');
}
function decodeHTML(buffer) {
  if (buffer.length > 40 * 1024 * 1024) throw new Error('这份 HTML 超过 40 MB，请先减少嵌入的超大素材。');
  let encoding = 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le';
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be';
  else {
    const declared = buffer.subarray(0, 4096).toString('ascii').match(/charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
    if (declared) encoding = declared;
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    return { text, encoding, bom: encoding.toLowerCase() === 'utf-8' && buffer.subarray(0, 3).equals(Buffer.from([239,187,191])) };
  } catch { throw new Error('无法正确读取这份文件的文字编码，请先从生成工具导出 UTF-8 HTML。'); }
}

class SourceDocument {
  constructor(text, options = {}) {
    this.attribute = options.attribute || `data-hs-${crypto.randomBytes(6).toString('hex')}`;
    this.counter = options.counter || 0;
    this.original = text;
    this.source = text;
    this.refresh();
  }
  refresh() {
    let tree = parse(this.source, { sourceCodeLocationInfo: true });
    const edits = [];
    const seen = new Set();
    visit(tree, node => {
      const loc = node.sourceCodeLocation?.startTag;
      if (!loc || !node.tagName) return;
      let existing = node.attrs.find(a => a.name === this.attribute)?.value;
      if (existing && !seen.has(existing)) {
        seen.add(existing);
        const n = Number(existing.slice(1));
        if (Number.isFinite(n)) this.counter = Math.max(this.counter, n);
        return;
      }
      const id = `n${++this.counter}`;
      if (existing) {
        const a = node.sourceCodeLocation.attrs[this.attribute];
        edits.push({ start:a.startOffset, end:a.endOffset, value:`${this.attribute}="${id}"` });
      } else {
        const tag = this.source.slice(loc.startOffset, loc.endOffset);
        const position = loc.endOffset - (tag.endsWith('/>') ? 2 : 1);
        edits.push({ start: position, end: position, value: ` ${this.attribute}="${id}"` });
      }
      seen.add(id);
    });
    if (edits.length) {
      this.source = editsApply(this.source, edits);
      tree = parse(this.source, { sourceCodeLocationInfo: true });
    }
    this.tree = tree;
    this.nodes = new Map();
    visit(tree, node => {
      const id = node.attrs?.find(a => a.name === this.attribute)?.value;
      if (id && node.sourceCodeLocation) this.nodes.set(id, node);
    });
  }
  setSource(source) { this.source = source; this.refresh(); }
  clean() {
    const edits = [];
    for (const node of this.nodes.values()) {
      const loc = node.sourceCodeLocation.attrs?.[this.attribute];
      if (loc) {
        // The one inserted space belongs to the editor, not to the user's tag.
        const start = this.source[loc.startOffset - 1] === ' ' ? loc.startOffset - 1 : loc.startOffset;
        edits.push({ start, end:loc.endOffset, value:'' });
      }
    }
    return editsApply(this.source, edits);
  }
  apply(operation) {
    const node = this.nodes.get(operation.id);
    if (!node) throw new Error('这处内容已经变化，请重新选中后修改。');
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag || ['script','style','head','html','base','link','meta','iframe','object','embed','template'].includes(node.tagName)) throw new Error('这部分内容暂不支持直接编辑。');
    const edits = [];
    if (operation.kind === 'attributes') {
      const permitted = new Set(['style','src','srcset','sizes','alt','width','height']);
      const added = [];
      for (const [name, value] of Object.entries(operation.values || {})) {
        if (!permitted.has(name)) throw new Error('不支持的修改属性。');
        if (value !== null && typeof value !== 'string') throw new Error('修改内容格式不正确。');
        const at = loc.attrs?.[name];
        const replacement = value === null ? '' : `${name}="${escapeAttribute(value)}"`;
        if (at) edits.push({ start:at.startOffset, end:at.endOffset, value:replacement });
        else if (replacement) added.push(replacement);
      }
      if (added.length) {
        const tag = this.source.slice(loc.startTag.startOffset, loc.startTag.endOffset);
        const end = loc.startTag.endOffset - (tag.endsWith('/>') ? 2 : 1);
        edits.push({ start:end, end, value:' ' + added.join(' ') });
      }
    } else if (operation.kind === 'inner') {
      if (!loc.endTag || node.tagName === 'body') throw new Error('不能安全修改这块文字，请选择更小的文字块。');
      if (typeof operation.html !== 'string' || operation.html.length > 5 * 1024 * 1024) throw new Error('文字内容过大。');
      edits.push({ start:loc.startTag.endOffset, end:loc.endTag.startOffset, value:operation.html });
    } else if (operation.kind === 'delete') {
      if (node.tagName === 'body') throw new Error('请先选中要删除的文字、图片或内容块。');
      edits.push({ start:loc.startOffset, end:loc.endOffset, value:'' });
    } else throw new Error('未知修改操作。');
    this.source = editsApply(this.source, edits);
    this.refresh();
  }
  editingHTML() {
    const edits = [];
    function walk(node, source) {
      const loc = node.sourceCodeLocation;
      if (loc && ['script','iframe','object','embed','template'].includes(node.tagName)) {
        edits.push({ start:loc.startOffset, end:loc.endOffset, value:'' });
        return;
      }
      if (loc && node.tagName === 'meta' && node.attrs.some(a => a.name === 'http-equiv')) {
        edits.push({ start:loc.startOffset, end:loc.endOffset, value:'' }); return;
      }
      for (const attr of node.attrs || []) {
        if (/^on/i.test(attr.name) || ['autofocus','contenteditable','autoplay','formaction','action'].includes(attr.name)) {
          const a = loc?.attrs?.[attr.name];
          if (a) edits.push({ start:a.startOffset,end:a.endOffset,value:'' });
        }
      }
      for (const child of node.childNodes || []) walk(child,source);
    }
    walk(this.tree, this.source);
    let result = editsApply(this.source, edits);
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' studio-doc: https: http: data:; img-src studio-doc: https: http: data: blob:; font-src studio-doc: https: http: data:; media-src studio-doc: https: http: data:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">`;
    const head = result.match(/<head\b[^>]*>/i);
    result = head ? result.slice(0, head.index + head[0].length) + policy + result.slice(head.index + head[0].length) : policy + result;
    return result;
  }
  nodeInfo(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    return Object.fromEntries(node.attrs.filter(a => a.name !== this.attribute).map(a => [a.name,a.value]));
  }
}

module.exports = { SourceDocument, decodeHTML, visit, editsApply, escapeAttribute };
