const BLOCK='h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,figcaption,caption,button,label';
const COMPLEX='svg,canvas,video,audio,iframe,object,embed';
const cssEscape=value=>CSS.escape(value);
const px=value=>Number.parseFloat(value)||0;
const attrObject=el=>Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]));
const rgbHex=value=>{const numbers=value?.match(/[\d.]+/g);return numbers?.length>=3?'#'+numbers.slice(0,3).map(x=>Math.max(0,Math.min(255,Math.round(+x))).toString(16).padStart(2,'0')).join(''):'#ffffff';};

export class CanvasEditor {
  constructor(frame,callbacks){
    this.frame=frame;this.callbacks=callbacks;this.pages=[];this.pageIndex=0;this.scale=1;this.selected=null;this.editing=null;this.savedRange=null;this.baselines=new Map();this.composing=false;this.pendingText=false;
  }
  id(el){return el?.getAttribute(this.attribute);}
  find(id){return this.doc?.querySelector(`[${this.attribute}="${cssEscape(id)}"]`);}
  record(el,source){if(this.id(el))this.baselines.set(this.id(el),{source:source||{},rendered:attrObject(el)});}
  captureBaseline(operation){
    const el=this.find(operation.id);if(!el)return new Map();
    const nodes=operation.kind==='inner'?[el,...el.querySelectorAll(`[${this.attribute}]`)]:[el];
    return new Map(nodes.map(node=>[this.id(node),attrObject(node)]));
  }
  rebase(attributes,snapshot){
    this.sourceAttributes=attributes;
    if(!snapshot){for(const el of this.doc.querySelectorAll(`[${this.attribute}]`))this.record(el,attributes[this.id(el)]||this.baselines.get(this.id(el))?.source);return;}
    for(const [id,rendered] of snapshot){if(attributes[id])this.baselines.set(id,{source:attributes[id],rendered});else this.baselines.delete(id);}
  }
  async load(payload){
    this.stylePriority=payload.document.stylePriority??'important';
    this.attribute=payload.attribute;this.sourceAttributes=payload.attributes;this.baselines.clear();this.selected=null;this.editing=null;this.savedRange=null;this.pendingText=false;
    this.frame.style.width='1280px';this.frame.style.height='720px';
    clearTimeout(this.textTimer);
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timeout);this.frame.onload=null;resolve();};
      const timeout=setTimeout(()=>{
        if(this.frame.contentDocument?.querySelector(`[${this.attribute}]`)){this.frame.contentWindow.stop();this.callbacks.notice('部分网络素材加载较慢，已先打开文稿。可在联网后重新载入。');finish();}
        else reject(new Error('文稿加载失败，请重新打开文件。'));
      },6000);
      this.frame.onload=finish;this.frame.srcdoc=payload.html;
    });
    this.doc=this.frame.contentDocument;this.win=this.frame.contentWindow;
    for(const el of this.doc.querySelectorAll(`[${this.attribute}]`))this.record(el,payload.attributes[this.id(el)]);
    this.detectPages();this.createHelpers();this.installEvents();
    this.showPage(Math.min(payload.document.page||0,this.pages.length-1));
    this.callbacks.pages(this.pages);this.callbacks.selection(null);
    this.reportMissing();
  }
  detectPages(){
    let elements=[],kind='single';
    const options=[['reveal','.reveal > .slides > section'],['stage','x-import[component-from-global-scope="deck-stage"] > section, deck-stage > section'],['slides','[data-slide]'],['slides','.slide'],['slides','.page'],['slides','.swiper-slide'],['slides','.slides > section'],['slides','.presentation > section'],['slides','.deck > section']];
    for(const [name,selector]of options){const found=[...this.doc.querySelectorAll(selector)].filter(el=>this.id(el));const top=found.filter(el=>!found.some(other=>other!==el&&other.contains(el)));if(top.length){elements=top;kind=name;break;}}
    if(!elements.length){const sections=[...this.doc.querySelectorAll('body > section, body > main > section')].filter(el=>this.id(el));if(sections.length>1&&sections.every(el=>el.getBoundingClientRect().height>=350)){elements=sections;kind='slides';}}
    if(!elements.length)elements=[this.doc.body];
    if(!this.id(this.doc.body)&&elements[0]===this.doc.body){this.callbacks.notice('这份文稿缺少可定位的正文结构，部分整体操作不可用。');}
    this.kind=kind;this.unknown=!!this.doc.querySelector('#root:empty,#app:empty')||(kind==='reveal'&&elements.some(el=>el.querySelector(':scope > section')));
    if(this.unknown)this.callbacks.notice('这份文稿含动态生成内容或嵌套分页，当前只能修改可见的普通内容。');
    this.pages=elements.map((el,index)=>{
      const c=this.win.getComputedStyle(el);const display=this.normalDisplay(el,c.display);
      let width=px(c.width),height=px(c.height);
      const rect=el.getBoundingClientRect();
      if(!width||width<300)width=rect.width>=300?rect.width:1280;
      if(kind==='stage'){
        width=px(el.parentElement.getAttribute('width'))||1920;height=px(el.parentElement.getAttribute('height'))||1080;
      }else if(kind==='reveal'){
        const size=this.doc.querySelector('.reveal > .slides');width=px(size?.style.width)||960;height=px(size?.style.height)||700;
      }else if(!height||height<200){height=Math.max(px(c.minHeight),kind==='single'?this.doc.body.scrollHeight:720);}
      if(kind==='single'){width=Math.max(320,Math.min(3000,width));height=Math.max(300,height,this.doc.body.scrollHeight);}
      if(c.boxSizing==='content-box'){width+=px(c.paddingLeft)+px(c.paddingRight)+px(c.borderLeftWidth)+px(c.borderRightWidth);height+=px(c.paddingTop)+px(c.paddingBottom)+px(c.borderTopWidth)+px(c.borderBottomWidth);}
      const title=el.querySelector('h1,h2,h3')?.textContent.trim()||el.textContent.trim().slice(0,24)||`第 ${index+1} 页`;
      return {id:this.id(el),el,index,width:Math.round(width),height:Math.round(height),display,title};
    });
    this.activeRules=this.activationRules();
  }
  activationRules(){
    // Project a slide's active-state selectors onto that slide without changing
    // any source class attributes, or executing presentation scripts.
    const result=[];
    const inspect=rules=>{for(const rule of rules){
      if(rule.cssRules&&!rule.selectorText){if(rule.conditionText&&rule.constructor.name==='CSSMediaRule'&&!this.win.matchMedia(rule.conditionText).matches)continue;inspect(rule.cssRules);continue;}
      if(!rule.selectorText||!rule.style)continue;
      for(const selector of rule.selectorText.split(',')){
        for(const match of selector.matchAll(/\.(?:active|current|present|is-active|is-current)\b/g)){
          const prefix=selector.slice(0,match.index).trim();if(!prefix)continue;
          for(const p of this.pages){try{if(p.el.matches(prefix))result.push(`[${this.attribute}="${p.id}"]${selector.slice(match.index+match[0].length)}{${rule.style.cssText}}`);}catch{}}
        }
      }
    }};
    for(const sheet of this.doc.styleSheets){try{inspect(sheet.cssRules);}catch{}}
    return result.join('\n');
  }
  normalDisplay(el,computed){
    if(computed!=='none')return computed;
    let display='block';
    const inspect=rules=>{for(const rule of rules){if(rule.cssRules&&!rule.selectorText){if(rule.constructor.name==='CSSMediaRule'&&!this.win.matchMedia(rule.conditionText).matches)continue;inspect(rule.cssRules);continue;}if(rule.selectorText&&rule.style?.display&&rule.style.display!=='none'){try{if(el.matches(rule.selectorText))display=rule.style.display;}catch{}}}};
    for(const sheet of this.doc.styleSheets){try{inspect(sheet.cssRules);}catch{}}
    return display;
  }
  pageCSS(index){
    const page=this.pages[index];if(!page)return '';
    let css=(this.activeRules||'')+`html{overflow:auto!important;scroll-behavior:auto!important}body{margin:0!important;min-height:0!important}*,*::before,*::after{animation-play-state:paused!important;animation-delay:-1s!important;animation-duration:.001s!important;animation-iteration-count:1!important;transition:none!important;caret-color:#157665}html,body{width:${page.width}px!important;min-width:0!important}body{height:auto!important;min-height:${page.height}px!important}a,button{cursor:default!important}::-webkit-scrollbar{width:0;height:0}`;
    if(this.kind!=='single'){
      const ancestors=new Set();this.pages.forEach(p=>{for(let el=p.el.parentElement;el&&el!==this.doc.body;el=el.parentElement)ancestors.add(el);});
      for(const el of ancestors){const id=this.id(el);if(id)css+=`[${this.attribute}="${id}"]{position:static!important;transform:none!important;display:block!important;opacity:1!important;visibility:visible!important;width:${page.width}px!important;height:auto!important;max-width:none!important;margin:0!important;padding:0!important}`;}
      css+='body{display:block!important;padding:0!important;overflow:hidden!important}';
      this.pages.forEach((p,i)=>{css+=`[${this.attribute}="${p.id}"]{${i!==index?'display:none!important':`display:${p.display}!important;position:relative!important;inset:auto!important;transform:none!important;opacity:1!important;visibility:visible!important;box-sizing:border-box!important;width:${page.width}px!important;min-height:${page.height}px!important;max-height:none!important;margin:0!important;float:none!important;`}}`;});
    }
    css+='.fragment{opacity:1!important;visibility:visible!important;transform:none!important}[data-hs-placeholder]{min-width:100px;min-height:50px;background:#e8efec44;outline:1px dashed #90a69b}';
    return css;
  }
  createHelpers(){
    this.viewStyle=this.doc.createElement('style');this.viewStyle.dataset.hsUi='view';this.doc.head.append(this.viewStyle);
    this.overlay=this.doc.createElement('div');this.overlay.dataset.hsUi='selection';this.overlay.style.cssText='position:fixed;display:none;border:2px solid #168674;pointer-events:none;box-sizing:border-box;z-index:2147483646;';
    for(const direction of ['top','bottom','left','right']){
      const edge=this.doc.createElement('div');edge.dataset.edge=direction;edge.style.cssText='position:absolute;pointer-events:auto;cursor:move;';
      edge.addEventListener('pointerdown',event=>this.beginDrag(event,'move'));this.overlay.append(edge);
    }
    this.handle=this.doc.createElement('div');this.handle.style.cssText='position:absolute;right:-5px;bottom:-5px;width:9px;height:9px;border:1.5px solid #168674;background:#fff;pointer-events:auto;cursor:nwse-resize;box-sizing:border-box;';
    this.handle.addEventListener('pointerdown',event=>this.beginDrag(event,'resize'));this.overlay.append(this.handle);
    this.hover=this.doc.createElement('div');this.hover.dataset.hsUi='hover';this.hover.style.cssText='position:fixed;display:none;pointer-events:none;border:1px solid #16867470;z-index:2147483645;box-sizing:border-box;';
    this.guideX=this.doc.createElement('div');this.guideY=this.doc.createElement('div');
    this.guideX.dataset.hsUi='guide';this.guideY.dataset.hsUi='guide';
    this.guideX.style.cssText='position:fixed;display:none;width:1px;background:#ed9d69;pointer-events:none;z-index:2147483644';
    this.guideY.style.cssText='position:fixed;display:none;height:1px;background:#ed9d69;pointer-events:none;z-index:2147483644';
    this.doc.body.append(this.overlay,this.hover,this.guideX,this.guideY);
    for(const canvas of this.doc.querySelectorAll('canvas'))canvas.dataset.hsPlaceholder='true';
  }
  installEvents(){
    this.doc.addEventListener('click',event=>{
      if(event.target.closest('[data-hs-ui]'))return;
      if(this.editing?.contains(event.target))return;
      event.preventDefault();event.stopPropagation();
      const target=this.pick(event.target);void this.finishText().then(()=>this.select(target));
    },true);
    this.doc.addEventListener('dblclick',event=>{
      if(event.target.closest('[data-hs-ui]'))return;
      event.preventDefault();event.stopPropagation();const target=this.textTarget(event.target);
      if(target&&!this.readOnly(target))this.startText(target);
    },true);
    this.doc.addEventListener('mouseover',event=>{
      if(this.dragging||this.editing||event.target.closest('[data-hs-ui]'))return;
      const el=this.pick(event.target);if(!el||el===this.selected){this.hover.style.display='none';return;}
      const rect=el.getBoundingClientRect();Object.assign(this.hover.style,{display:'block',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    });
    this.doc.addEventListener('contextmenu',event=>{
      event.preventDefault();const target=this.pick(event.target);if(target)this.select(target);
      const frameRect=this.frame.getBoundingClientRect();this.callbacks.context({x:frameRect.left+event.clientX*this.scale,y:frameRect.top+event.clientY*this.scale,candidates:this.elementsAt(event.clientX,event.clientY)});
    });
    this.doc.addEventListener('selectionchange',()=>this.saveRange());
    this.doc.addEventListener('keydown',event=>this.onKey(event),true);
    this.doc.addEventListener('dragstart',event=>event.preventDefault());
    this.doc.addEventListener('dragover',event=>event.preventDefault());
    this.doc.addEventListener('drop',event=>{event.preventDefault();this.callbacks.drop?.([...event.dataTransfer.files]);});
    this.doc.addEventListener('submit',event=>event.preventDefault());
    this.doc.addEventListener('paste',event=>{
      if(!this.editing)return;event.preventDefault();this.restoreRange();
      this.doc.execCommand('insertText',false,event.clipboardData.getData('text/plain'));this.textChanged();
    });
    this.doc.addEventListener('compositionstart',()=>{this.composing=true;});
    this.doc.addEventListener('compositionend',()=>{this.composing=false;this.textChanged();});
    this.doc.addEventListener('input',()=>this.textChanged());
    this.doc.addEventListener('beforeinput',event=>{
      if(this.editing&&event.inputType==='insertParagraph'){
        event.preventDefault();this.doc.execCommand('insertLineBreak');this.textChanged();
      }
    });
    this.win.addEventListener('scroll',()=>this.positionOverlay());
    this.doc.addEventListener('error',event=>{if(event.target.tagName==='IMG')this.callbacks.notice('有图片没有找到，可从“更多”中定位素材文件夹。');},true);
    this.resizeObserver?.disconnect();this.resizeObserver=new ResizeObserver(()=>this.positionOverlay());this.resizeObserver.observe(this.doc.body);
  }
  pick(target){
    if(!target||target.nodeType!==1)return null;
    if(target.closest('[data-hs-ui]'))return null;
    const complex=target.closest(COMPLEX);if(complex)return this.id(complex)?complex:complex.closest(`[${this.attribute}]`);
    const image=target.closest('img');if(image)return image;
    const text=this.textTarget(target);if(text)return text;
    let el=target.closest(`[${this.attribute}]`);
    if(!el||el===this.doc.body||this.pages.some(p=>p.el===el))return null;
    if(el.getBoundingClientRect().width<2||el.getBoundingClientRect().height<2)return null;
    return el;
  }
  textTarget(target){
    const el=target.nodeType===3?target.parentElement:target;
    if(!el||el.closest(COMPLEX)||el.tagName==='IMG')return null;
    const block=el.closest(BLOCK);if(block&&this.id(block)&&!block.querySelector('img,svg,canvas,video,iframe,table'))return block;
    for(let node=el;node&&node!==this.doc.body&&!this.pages.some(p=>p.el===node);node=node.parentElement){
      if(!this.id(node))continue;
      if(node.matches('div,span,a,small,strong,em')&&node.textContent.trim()&&!node.querySelector('div,p,h1,h2,h3,h4,ul,ol,table,img,svg,canvas,section,article,video'))return node;
    }
    return null;
  }
  type(el){if(!el)return 'page';if(el.matches(COMPLEX))return 'readonly';if(el.tagName==='IMG')return 'image';const background=this.win.getComputedStyle(el).backgroundImage;if(!el.textContent.trim()&&/^url\(/.test(background)&&!background.includes('),'))return 'image';if(this.textTarget(el)===el)return 'text';return 'block';}
  readOnly(el){return el?.matches(COMPLEX)||this.pages.some(p=>p.el===el)||!this.id(el);}
  select(el){
    if(el&&!el.isConnected)el=null;
    this.selected=el;this.hover.style.display='none';this.positionOverlay();
    if(!el){this.callbacks.selection(null);return;}
    const style=this.win.getComputedStyle(el),type=this.type(el);
    this.callbacks.selection({type,id:this.id(el),label:el.tagName==='IMG'?(el.alt||'图片'):el.textContent.trim().slice(0,45)||'内容块',fontSize:Math.round(px(style.fontSize)),color:rgbHex(style.color),bold:px(style.fontWeight)>=600,italic:style.fontStyle==='italic',align:style.textAlign,background:rgbHex(style.backgroundColor),backgroundEditable:style.backgroundImage==='none'&&(type==='block'||type==='text'),fit:el.tagName==='IMG'?style.objectFit:style.backgroundSize,position:el.tagName==='IMG'?style.objectPosition:style.backgroundPosition,canParent:!!this.parentCandidate(),readonly:this.readOnly(el),width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)});
  }
  parentCandidate(){let el=this.selected?.parentElement;while(el&&el!==this.doc.body){if(this.pages.some(p=>p.el===el))return null;if(this.id(el)&&!el.matches('a,span,strong,em,small'))return el;el=el.parentElement;}return null;}
  async selectParent(){await this.finishText();const parent=this.parentCandidate();if(parent)this.select(parent);}
  elementsAt(x,y){const seen=new Set();return this.doc.elementsFromPoint(x,y).map(el=>this.pick(el)).filter(el=>{const id=this.id(el);if(!id||seen.has(id))return false;seen.add(id);return true;}).slice(0,8).map(el=>({id:this.id(el),label:this.type(el)==='image'?'图片 · '+(el.alt||'未命名'):el.textContent.trim().slice(0,25)||'内容块'}));}
  positionOverlay(){
    if(!this.overlay)return;
    if(!this.selected?.isConnected){this.overlay.style.display='none';return;}
    const rect=this.selected.getBoundingClientRect();Object.assign(this.overlay.style,{display:'block',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px',borderWidth:(1.5/this.scale)+'px'});
    const area=6/this.scale;
    for(const edge of this.overlay.querySelectorAll('[data-edge]')){
      const direction=edge.dataset.edge;
      edge.style.display=this.editing||this.readOnly(this.selected)?'none':'block';
      if(direction==='top'||direction==='bottom'){edge.style.cssText+=`;left:0;right:0;height:${area*2}px;${direction}:${-area}px`;}
      else edge.style.cssText+=`;top:0;bottom:0;width:${area*2}px;${direction}:${-area}px`;
    }
    const type=this.type(this.selected);this.handle.style.display=!this.editing&&['image','text'].includes(type)?'block':'none';this.handle.style.width=8/this.scale+'px';this.handle.style.height=8/this.scale+'px';
  }
  setScale(scale){this.scale=scale;this.positionOverlay();}
  showPage(index){
    this.pageIndex=Math.max(0,Math.min(this.pages.length-1,Number.isInteger(index)?index:0));this.selected=null;this.savedRange=null;
    const page=this.pages[this.pageIndex];this.viewStyle.textContent=this.pageCSS(this.pageIndex);
    this.frame.style.width=page.width+'px';this.frame.style.height=page.height+'px';
    this.win.scrollTo(0,0);this.positionOverlay();this.callbacks.selection(null);this.callbacks.page(page);
  }
  startText(el){
    if(this.editing===el)return;
    if(this.editing){void this.finishText().then(()=>this.startText(el));return;}
    this.select(el);this.editing=el;this.textBefore=this.cleanInner(el);this.pendingText=false;
    el.setAttribute('contenteditable','true');el.setAttribute('spellcheck','false');el.focus();
    const selection=this.win.getSelection();if(!selection.rangeCount||!el.contains(selection.anchorNode)){const range=this.doc.createRange();range.selectNodeContents(el);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
    this.saveRange();this.positionOverlay();this.callbacks.editing(true);
  }
  saveRange(){
    if(!this.editing)return;const selection=this.win.getSelection();
    if(selection.rangeCount&&this.editing.contains(selection.anchorNode)&&this.editing.contains(selection.focusNode))this.savedRange=selection.getRangeAt(0).cloneRange();
  }
  restoreRange(){if(this.savedRange&&this.editing){try{this.editing.focus();const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(this.savedRange);}catch{this.savedRange=null;}}}
  textChanged(){
    if(!this.editing)return;this.pendingText=true;this.saveRange();this.positionOverlay();this.callbacks.dirty();
    clearTimeout(this.textTimer);if(!this.composing)this.textTimer=setTimeout(()=>void this.flushText(),850);
  }
  styleForSave(el){
    const baseline=this.baselines.get(this.id(el));if(!baseline)return el.getAttribute('style')||'';
    const original=this.doc.createElement('div');original.setAttribute('style',baseline.source.style||'');
    const before=this.doc.createElement('div');before.setAttribute('style',baseline.rendered.style||'');
    const keys=new Set([...before.style,...el.style]);
    for(const key of keys){if(before.style.getPropertyValue(key)!==el.style.getPropertyValue(key)||before.style.getPropertyPriority(key)!==el.style.getPropertyPriority(key)){if(el.style.getPropertyValue(key))original.style.setProperty(key,el.style.getPropertyValue(key),el.style.getPropertyPriority(key));else original.style.removeProperty(key);}}
    return original.getAttribute('style')||'';
  }
  cleanInner(el){
    const clone=el.cloneNode(true);
    for(const node of [clone,...clone.querySelectorAll('*')]){
      if(node.hasAttribute('data-hs-ui')){node.remove();continue;}
      const id=this.id(node),baseline=this.baselines.get(id);
      if(baseline){
        const original=this.find(id);
        if(original&&node.hasAttribute('style'))node.setAttribute('style',this.styleForSave(original));
        for(const [name,value]of Object.entries(baseline.source)){
          if(/^on/i.test(name)||['contenteditable','autofocus','autoplay','formaction','action'].includes(name))node.setAttribute(name,value);
          else if(['src','srcset','href','poster'].includes(name)&&node.getAttribute(name)===baseline.rendered[name])node.setAttribute(name,value);
        }
      }
      for(const name of ['data-hs-placeholder'])node.removeAttribute(name);
    }
    return clone.innerHTML;
  }
  async flushText(){
    clearTimeout(this.textTimer);
    if(this.flushingText){await this.flushingText;return this.flushText();}
    if(!this.editing||!this.pendingText||this.composing)return;
    const el=this.editing,html=this.cleanInner(el);
    if(html===this.textBefore){this.pendingText=false;this.callbacks.settled?.();return;}
    this.flushingText=(async()=>{
      await this.callbacks.operation({id:this.id(el),kind:'inner',html},'修改文字',`text-${this.id(el)}`);
      this.textBefore=html;this.pendingText=this.cleanInner(el)!==html;this.callbacks.settled?.();this.overflowHint(el);
    })();
    try{await this.flushingText;}finally{this.flushingText=null;}
    if(this.pendingText&&!this.composing)return this.flushText();
  }
  async finishText(){
    if(!this.editing)return;
    if(this.composing){this.editing.blur();await new Promise(resolve=>setTimeout(resolve,50));}
    if(this.composing)throw new Error('请先完成当前输入，再保存或切换文稿。');
    await this.flushText();const el=this.editing;if(!el)return;
    const original=this.baselines.get(this.id(el))?.source||{};
    if(original.contenteditable!==undefined)el.setAttribute('contenteditable',original.contenteditable);else el.removeAttribute('contenteditable');
    if(original.spellcheck!==undefined)el.setAttribute('spellcheck',original.spellcheck);else el.removeAttribute('spellcheck');
    this.editing=null;this.savedRange=null;this.win.getSelection().removeAllRanges();this.positionOverlay();this.callbacks.editing(false);
  }
  async textStyle(property,value){
    if(!this.selected||this.readOnly(this.selected))return;
    if(this.editing&&this.savedRange&&!this.savedRange.collapsed&&property!=='text-align'){
      this.restoreRange();const range=this.savedRange;const fragment=range.extractContents();const span=this.doc.createElement('span');span.style.setProperty(property,value);
      for(const descendant of fragment.querySelectorAll('*'))if(descendant.style.getPropertyValue(property))descendant.style.setProperty(property,value);
      span.append(fragment);range.insertNode(span);range.selectNodeContents(span);const selection=this.win.getSelection();selection.removeAllRanges();selection.addRange(range);this.savedRange=range.cloneRange();this.textChanged();this.select(this.selected);return;
    }
    await this.flushText();const el=this.selected;el.style.setProperty(property,value,this.stylePriority);
    await this.commitStyle(el,'修改文字样式');this.select(el);this.overflowHint(el);
  }
  async commitStyle(el,label,merge){await this.callbacks.operation({id:this.id(el),kind:'attributes',values:{style:this.styleForSave(el)}},label,merge);this.positionOverlay();}
  async background(color,page=false){
    await this.finishText();const el=page||!this.selected?this.pages[this.pageIndex].el:this.selected;
    if(!this.id(el)){this.callbacks.notice('这页暂不支持整体修改背景。');return;}
    if(this.win.getComputedStyle(el).backgroundImage!=='none'){this.callbacks.notice('这个背景包含图片或渐变，暂时保留原样。');return;}
    el.style.setProperty('background-color',color,this.stylePriority);await this.commitStyle(el,'修改背景色');
  }
  async replaceImage(url){
    await this.finishText();const el=this.selected;if(!el||this.type(el)!=='image')return;
    const c=this.win.getComputedStyle(el);const width=el.offsetWidth,height=el.offsetHeight;
    el.style.setProperty('width',width+'px',this.stylePriority);el.style.setProperty('height',height+'px',this.stylePriority);el.style.setProperty('box-sizing','border-box',this.stylePriority);
    const values={};if(el.tagName==='IMG'){el.src=url;el.removeAttribute('srcset');el.removeAttribute('sizes');el.style.setProperty('object-fit','cover',this.stylePriority);el.style.setProperty('object-position','50% 50%',this.stylePriority);values.src=url;values.srcset=null;values.sizes=null;}
    else{el.style.setProperty('background-image',`url("${url}")`,this.stylePriority);el.style.setProperty('background-size','cover',this.stylePriority);el.style.setProperty('background-position','50% 50%',this.stylePriority);}
    values.style=this.styleForSave(el);await this.callbacks.operation({id:this.id(el),kind:'attributes',values},'替换图片');this.select(el);
  }
  async imageFit(fit){const el=this.selected;if(!el||this.type(el)!=='image')return;el.style.setProperty(el.tagName==='IMG'?'object-fit':'background-size',fit,this.stylePriority);await this.commitStyle(el,'调整图片显示');this.select(el);}
  async imagePosition(x,y,el=this.selected){if(!el?.isConnected||this.type(el)!=='image')return;el.style.setProperty(el.tagName==='IMG'?'object-position':'background-position',`${x}% ${y}%`,this.stylePriority);await this.commitStyle(el,'调整图片位置',`crop-${this.id(el)}`);}
  async deleteSelected(){await this.finishText();const el=this.selected;if(!el||this.readOnly(el))return;const id=this.id(el);el.remove();this.selected=null;await this.callbacks.operation({id,kind:'delete'},'删除内容');this.select(null);}
  translation(el){const t=this.win.getComputedStyle(el).translate.split(/\s+/);const rect=el.getBoundingClientRect();const value=(v,size)=>v?.endsWith('%')?px(v)*size/100:px(v);return [value(t[0],rect.width),value(t[1],rect.height)];}
  movable(el){for(let node=el.parentElement;node&&node!==this.pages[this.pageIndex].el;node=node.parentElement){if(this.win.getComputedStyle(node).transform!=='none')return false;}return !this.readOnly(el);}
  async nudge(dx,dy){if(!this.selected||!this.movable(this.selected)){this.callbacks.notice('这个内容块暂不支持移动。');return;}const el=this.selected,[x,y]=this.translation(el);el.style.setProperty('translate',`${x+dx}px ${y+dy}px`,this.stylePriority);await this.commitStyle(el,'移动内容',`move-${this.id(el)}`);this.overflowHint(el);}
  beginDrag(event,mode){
    if(event.button!==0||!this.selected||!this.movable(this.selected)){if(this.selected)this.callbacks.notice('这个内容块暂不支持移动。');return;}
    event.preventDefault();event.stopPropagation();const el=this.selected,handle=event.currentTarget;handle.setPointerCapture(event.pointerId);
    const start={x:event.clientX,y:event.clientY,rect:el.getBoundingClientRect(),width:el.offsetWidth,height:el.offsetHeight,translation:this.translation(el),style:el.getAttribute('style')};this.dragging=true;this.hover.style.display='none';let moved=false;
    const update=e=>{
      let dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)+Math.abs(dy)>1)moved=true;
      this.guideX.style.display=this.guideY.style.display='none';
      if(mode==='move'){
        if(!e.altKey){const snap=this.snap(start.rect,dx,dy);dx=snap.dx;dy=snap.dy;}
        el.style.setProperty('translate',`${start.translation[0]+dx}px ${start.translation[1]+dy}px`,this.stylePriority);
      }else{
        const width=Math.max(24,start.width+dx);el.style.setProperty('width',width+'px',this.stylePriority);el.style.setProperty('box-sizing','border-box',this.stylePriority);el.style.setProperty('max-width','none',this.stylePriority);
        if(this.type(el)==='image')el.style.setProperty('height',Math.max(20,start.height*width/start.width)+'px',this.stylePriority);
      }
      this.positionOverlay();
    };
    const finish=async e=>{
      handle.removeEventListener('pointermove',update);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',cancel);if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);this.dragging=false;this.guideX.style.display=this.guideY.style.display='none';
      if(moved){await this.commitStyle(el,mode==='move'?'移动内容':'调整大小');this.overflowHint(el);this.select(el);}
    };
    const cancel=e=>{el.setAttribute('style',start.style||'');moved=false;void finish(e);};
    handle.addEventListener('pointermove',update);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',cancel);
  }
  snap(rect,dx,dy){
    const page=this.pages[this.pageIndex],p=page.el.getBoundingClientRect();const xs=[p.left,p.left+page.width/2,p.left+page.width],ys=[p.top,p.top+page.height/2,p.top+page.height];
    const siblings=[...this.selected.parentElement.children].filter(el=>el!==this.selected&&!el.hasAttribute('data-hs-ui')&&el.getBoundingClientRect().width>0).slice(0,50);
    for(const el of siblings){const r=el.getBoundingClientRect();xs.push(r.left,r.right,r.left+r.width/2);ys.push(r.top,r.bottom,r.top+r.height/2);}
    let bestX=5/this.scale,bestY=5/this.scale,sx=null,sy=null;
    for(const x of xs)for(const anchor of [rect.left+dx,rect.right+dx,rect.left+rect.width/2+dx])if(Math.abs(x-anchor)<Math.abs(bestX)){bestX=x-anchor;sx=x;}
    for(const y of ys)for(const anchor of [rect.top+dy,rect.bottom+dy,rect.top+rect.height/2+dy])if(Math.abs(y-anchor)<Math.abs(bestY)){bestY=y-anchor;sy=y;}
    if(sx!==null){dx+=bestX;Object.assign(this.guideX.style,{display:'block',left:sx+'px',top:p.top+'px',height:page.height+'px'});}
    if(sy!==null){dy+=bestY;Object.assign(this.guideY.style,{display:'block',top:sy+'px',left:p.left+'px',width:page.width+'px'});}
    return {dx,dy};
  }
  overflowHint(el){const r=el.getBoundingClientRect(),p=this.pages[this.pageIndex];if(el.scrollHeight>el.clientHeight+3&&el.clientHeight>0||r.right>p.width+2||r.bottom>p.height+2||r.left< -2||r.top< -2)this.callbacks.notice('内容可能超出边界，可调整字号、文字框或位置。');}
  onKey(event){
    if(event.isComposing||this.composing)return;
    const modifier=event.ctrlKey||event.metaKey;
    if(modifier&&['s','o','z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();this.callbacks.shortcut(event.key.toLowerCase(),event.shiftKey);return;}
    if(event.key==='F5'){event.preventDefault();this.callbacks.shortcut('play',false);return;}
    if(this.editing){
      if(event.key==='Escape'){event.preventDefault();void this.finishText();}
      if(modifier&&['b','i'].includes(event.key.toLowerCase())){event.preventDefault();const property=event.key.toLowerCase()==='b'?'font-weight':'font-style';const active=property==='font-weight'?this.win.getComputedStyle(this.editing).fontWeight>=600:this.win.getComputedStyle(this.editing).fontStyle==='italic';void this.textStyle(property,property==='font-weight'?(active?'normal':'bold'):(active?'normal':'italic'));}
      return;
    }
    if(event.key==='Escape'){this.select(null);return;}
    if(this.selected&&['Delete','Backspace'].includes(event.key)){event.preventDefault();void this.deleteSelected();return;}
    if(this.selected&&event.key.startsWith('Arrow')){event.preventDefault();const n=event.shiftKey?10:1;void this.nudge(event.key==='ArrowRight'?n:event.key==='ArrowLeft'?-n:0,event.key==='ArrowDown'?n:event.key==='ArrowUp'?-n:0);}
    else if(!this.selected&&['PageDown','PageUp'].includes(event.key)){event.preventDefault();this.callbacks.navigate(this.pageIndex+(event.key==='PageDown'?1:-1));}
  }
  thumbnailHTML(index){
    const clone=this.doc.documentElement.cloneNode(true);clone.querySelectorAll('[data-hs-ui]').forEach(el=>el.remove());clone.querySelectorAll('[contenteditable]').forEach(el=>el.removeAttribute('contenteditable'));
    if(this.kind!=='single')for(const page of this.pages){if(page.index!==index){const el=clone.querySelector(`[${this.attribute}="${page.id}"]`);if(el)el.replaceChildren();}}
    const style=this.doc.createElement('style');style.textContent=this.pageCSS(index);clone.querySelector('head').append(style);
    return '<!doctype html>'+clone.outerHTML;
  }
  reportMissing(){
    const images=[...this.doc.images];if(images.some(img=>img.complete&&img.naturalWidth===0))this.callbacks.notice('有图片未能显示，可从“更多”中定位素材文件夹。');
    this.doc.fonts?.ready.then(()=>{
      const fonts=new Set([...this.doc.querySelectorAll('h1,h2,h3,p')].slice(0,60).map(el=>this.win.getComputedStyle(el).fontFamily.split(',')[0].trim()));
      for(const font of fonts){if(!/^(serif|sans-serif|system-ui|monospace|inherit)$/i.test(font)&&!this.doc.fonts.check(`16px ${font}`)){this.callbacks.notice('当前设备没有文稿使用的部分字体，显示可能有差异。');break;}}
    });
  }
}
