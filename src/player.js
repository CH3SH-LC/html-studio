async function startPlayer(config) {
  const {attribute,pages,start}=config;
  const clamp=n=>Math.max(0,Math.min(pages.length-1,n));
  const hint=document.createElement('div');hint.textContent='按 Esc 返回编辑';
  hint.style.cssText='position:fixed;z-index:2147483647;top:18px;right:22px;background:#172624cc;color:#fff;padding:9px 16px;border-radius:30px;font:13px system-ui;pointer-events:none;';
  // Bundles unpack asynchronously; custom stages may live in an open shadow root.
  function deep(selector,root=document){
    const direct=root.querySelector(selector);if(direct)return direct;
    for(const el of root.querySelectorAll('*'))if(el.shadowRoot){const found=deep(selector,el.shadowRoot);if(found)return found;}
    return null;
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let stage;
  for(let attempt=0;attempt<100;attempt++){
    stage=deep('deck-stage');
    const hasPages=!pages.length||deep(`[${attribute}="${pages[0].id}"]`);
    if(hasPages&&(!deep('x-import[component-from-global-scope="deck-stage"]')||typeof stage?.goTo==='function'))break;
    if(attempt===99)throw new Error('演示稿的页面未能加载，请检查它的配套素材。');
    await delay(100);
  }
  document.body.append(hint);setTimeout(()=>hint.remove(),3000);
  function keyboard(navigate,current=()=>window.__htmlStudioPage??start){
    addEventListener('keydown',event=>{
      if(event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable)return;
      let next;
      if(['ArrowRight','ArrowDown',' ','PageDown'].includes(event.key))next=current()+1;
      if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key))next=current()-1;
      if(event.key==='Home')next=0;if(event.key==='End')next=pages.length-1;
      if(next===undefined)return;
      event.preventDefault();event.stopImmediatePropagation();navigate(clamp(next));
    },true);
  }
  if(typeof stage?.goTo==='function'){
    stage.goTo(start);window.__htmlStudioPage=stage.index;window.__htmlStudioNavigation='deck-stage';
    keyboard(index=>{stage.goTo(index);window.__htmlStudioPage=stage.index;});
    stage.addEventListener('slidechange',()=>{window.__htmlStudioPage=stage.index;});return;
  }
  if(window.Reveal&&typeof window.Reveal.slide==='function'){
    const ready=()=>{window.Reveal.slide(start,0);window.__htmlStudioPage=window.Reveal.getIndices().h;window.Reveal.on('slidechanged',event=>window.__htmlStudioPage=event.indexh);};
    if(window.Reveal.isReady?.())ready();else window.Reveal.on('ready',ready);
    window.__htmlStudioNavigation='reveal';return;
  }
  if(pages.length<2){window.__htmlStudioPage=0;window.__htmlStudioNavigation='single';return;}
  const elements=pages.map(p=>deep(`[${attribute}="${p.id}"]`));
  const active=el=>el?.classList.contains('active')||el?.classList.contains('current')||el?.classList.contains('present')||el?.classList.contains('is-active');
  // Use the original controls so closure-held indices, counters and animations
  // remain consistent with both pointer and keyboard navigation.
  const groups=new Map();
  for(const el of document.querySelectorAll('.dot,[data-slide-to]')){
    if(elements.some(slide=>slide?.contains(el)))continue;
    const group=groups.get(el.parentElement)||[];group.push(el);groups.set(el.parentElement,group);
  }
  const controls=[...groups.values()].find(group=>group.length===pages.length);
  if(controls&&elements.some(active)){
    let desired=start,running=false;
    const sync=()=>{const index=elements.findIndex(active);if(index>=0){window.__htmlStudioPage=index;if(!running)desired=index;}};
    controls[start].click();await delay(50);sync();
    if(window.__htmlStudioPage===start){
      window.__htmlStudioNavigation='native-controls';
      const navigate=async index=>{
        desired=index;if(running)return;running=true;
        try{let target;do{target=desired;controls[target].click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));sync();}while(target!==desired);}
        finally{running=false;sync();}
      };
      keyboard(navigate,()=>desired);
      const observer=new MutationObserver(sync);for(const el of elements)observer.observe(el,{attributes:true,attributeFilter:['class']});return;
    }
  }
  let index=start;const helper=document.createElement('style');document.head.append(helper);
  const ancestors=new Set();elements.forEach(el=>{for(let n=el?.parentElement;n&&n!==document.body;n=n.parentElement)ancestors.add(n);});
  function show(next){
    index=clamp(next);window.__htmlStudioPage=index;
    const spec=pages[index],scale=Math.min(innerWidth/spec.width,innerHeight/spec.height);
    let rules=`html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important}body{background:#111!important}`;
    for(const ancestor of ancestors){const id=ancestor.getAttribute(attribute);if(id)rules+=`[${attribute}="${id}"]{position:static!important;transform:none!important;display:block!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important}`;}
    pages.forEach((p,i)=>{rules+=`[${attribute}="${p.id}"]{${i===index?`display:${p.display}!important;visibility:visible!important;opacity:1!important;position:absolute!important;left:${(innerWidth-spec.width*scale)/2}px!important;top:${(innerHeight-spec.height*scale)/2}px!important;right:auto!important;bottom:auto!important;box-sizing:border-box!important;width:${p.width}px!important;height:${p.height}px!important;min-height:0!important;margin:0!important;transform:scale(${scale})!important;transform-origin:top left!important;`:'display:none!important;'}}`;});helper.textContent=rules;
  }
  let activeState=elements.map(active);
  const observer=new MutationObserver(()=>{const updated=elements.map(active),changed=updated.findIndex((value,i)=>value&&!activeState[i]);activeState=updated;if(changed>=0)show(changed);});
  elements.forEach(el=>{if(el)observer.observe(el,{attributes:true,attributeFilter:['class']});});
  keyboard(show);addEventListener('resize',()=>show(index));show(index);window.__htmlStudioNavigation='static';
}
