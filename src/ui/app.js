import { CanvasEditor } from './canvas.js';
const $=id=>document.getElementById(id);
const show=(id,visible=true)=>$(id).classList.toggle('hidden',!visible);
let state=null,draining=null,scale=1,autoFit=true,selection=null,toastTimer,thumbnailTimer,alertAction=null,dragDepth=0,busy=false,localDirty=false,forcePageBackground=false;
const pendingOperations=[];
const thumbnailFrames=new Map();
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);show('toast');toastTimer=setTimeout(()=>show('toast',false),error?8000:4200);}
function errorMessage(error){toast(error?.message||'操作没有完成，请重试。',true);if(pendingOperations.length)showAlert('修改尚未提交成功，当前画面仍保留。请重试后再保存。','重试',()=>flush());else if(error?.code==='CONFLICT'){showAlert('文件已被其他软件修改，请另存为以保留两个版本。','另存为',()=>save('as'));}}
async function task(fn){try{return await fn();}catch(error){errorMessage(error);return null;}}
const command=(name,payload)=>window.studio.command(name,payload);
function showAlert(text,label,action){$('alertText').textContent=text;$('alertAction').textContent=label||'';$('alertAction').classList.toggle('hidden',!label);alertAction=action;show('alertBar');}
function updateState(result){
  if(!result)return;state={...state,...result};
  if(result.document){state.document={...(state.document||{}),...result.document};$('filename').textContent=state.document.name;$('filename').title=state.document.file;setSaveStatus();$('undo').disabled=!state.document.canUndo;$('redo').disabled=!state.document.canRedo;document.title=state.document.name+' · HTML Studio';if(state.document.conflict)showAlert('文件已被 AI 或其他软件更新。当前修改仍保留。','另存为',()=>save('as'));}
  if(result.recent)renderRecent(result.recent);
}
function setSaveStatus(){const dirty=state?.document?.dirty||localDirty;$('saveState').textContent=dirty?'未保存':state?.document?.owned?'已保存':'原稿';$('saveState').className='save-state'+(dirty?' dirty':'');}
function renderRecent(recent){
  $('recentList').replaceChildren();show('recent',recent.length>0);
  for(const item of recent){const button=document.createElement('button');button.className='recent-item';const title=document.createElement('strong');title.textContent=item.name;const folder=document.createElement('small');folder.textContent=item.exists?item.folder:'文件已移动 · 点击重新定位';button.append(title,folder);button.title=item.folder;button.onclick=()=>void task(()=>open({recent:item.index}));$('recentList').append(button);}
}
async function operation(op,label,merge){
  localDirty=true;setSaveStatus();
  pendingOperations.push({op,label,merge,page:canvas.pageIndex,snapshot:canvas.captureBaseline(op)});
  return drainOperations();
}
function drainOperations(){
  if(draining)return draining;
  draining=(async()=>{
    while(pendingOperations.length){
      const entry=pendingOperations[0];
      const result=await command('commit',{operation:entry.op,label:entry.label,merge:entry.merge,page:entry.page,revision:state.document.revision});
      pendingOperations.shift();updateState(result);canvas.rebase(result.attributes,entry.snapshot);settled();scheduleThumbnails();
    }
  })().finally(()=>{draining=null;});
  return draining;
}
function settled(){localDirty=!!pendingOperations.length||canvas.pendingText;setSaveStatus();}
const canvas=new CanvasEditor($('canvas'),{
  operation,
  pages:()=>buildThumbnails(),
  page:page=>{ $('pageStatus').textContent=`第 ${canvas.pageIndex+1} / ${canvas.pages.length} 页`;$('pageCount').textContent=canvas.pages.length;$('previousPage').disabled=canvas.pageIndex===0;$('nextPage').disabled=canvas.pageIndex===canvas.pages.length-1;document.querySelectorAll('.thumbnail').forEach((button,i)=>button.classList.toggle('active',i===canvas.pageIndex));void command('page',{page:canvas.pageIndex});fitCanvas(); },
  selection:info=>selectionChanged(info),
  notice:message=>toast(message),
  context:info=>openContext(info),
  dirty:()=>{localDirty=true;setSaveStatus();},
  settled,
  editing:()=>{},
  navigate:index=>void task(()=>goPage(index)),
  drop:files=>openDropped(files),
  shortcut:(key,shift)=>void task(()=>shortcut(key,shift))
});
async function load(result,keepZoom=false){
  if(!result?.html)return;busy=true;show('loading');show('home',false);show('workspace');show('fileInfo');show('documentActions');show('alertBar',false);hideMenus();updateState(result);
  try{
    localDirty=false;if(!keepZoom)autoFit=true;await canvas.load(result);state.html=result.html;setSaveStatus();
    const resources=result.document.resources;
    if(resources.missing.length)showAlert(`${resources.missing.length} 项本地素材未找到，部分图片或样式可能缺失。`,'定位素材',()=>locateAssets());
    else if(resources.remote.length)showAlert('这份文稿引用了网络素材，离线时部分内容可能无法显示。','查看说明',()=>openHelp());
    if(!/^utf-?8$/i.test(result.document.encoding))toast('这份文稿使用旧文字编码，修改后保存将转换为 UTF-8。');
  }finally{busy=false;show('loading',false);}
}
async function flush(){clearTimeout(cropTimer);if(cropPending){const pending=cropPending;cropPending=null;await pending();}await drainOperations();await canvas.finishText();await drainOperations();settled();}
async function open(options={}){if(busy)return;await flush();const result=await command('open',options);if(result)await load(result);}
async function save(mode='save'){
  if(!state?.document)return;await flush();
  try{
    const result=await command('save',{mode});if(!result)return;localDirty=false;updateState(result);if(!result.document.conflict)show('alertBar',false);
    const note=result.output?.folder?'已保存。分享时请带上旁边的素材文件夹。':'已保存，可以继续演示。';toast(note);
  }catch(error){$('saveState').textContent='保存失败';$('saveState').className='save-state error';showAlert('没有保存成功，修改仍在。可以重试，或换一个位置保存。','另存为',()=>save('as'));throw error;}
}
async function history(direction){if(!state?.document)return;await flush();const result=await command('history',{direction});if(result){const selectedId=selection?.id;await load(result,true);if(selectedId)canvas.select(canvas.find(selectedId));}}
async function home(){await flush();const result=await command('home');if(!result)return;state=result;localDirty=false;clearTimeout(thumbnailTimer);thumbnailObserver.disconnect();thumbnailFrames.clear();$('thumbnails').replaceChildren();canvas.pages=[];canvas.selected=null;canvas.resizeObserver?.disconnect();canvas.frame.srcdoc='';show('workspace',false);show('home');show('fileInfo',false);show('documentActions',false);hideMenus();renderRecent(result.recent);document.title='HTML Studio';}
async function goPage(index){if(!state?.document||index<0||index>=canvas.pages.length||busy)return;await flush();hideMenus();canvas.showPage(index);const thumb=$('thumbnails').children[index];thumb?.scrollIntoView({block:'nearest'});}
async function play(first=false){if(!state?.document)return;await flush();await command('play',{page:first?0:canvas.pageIndex,pages:canvas.pages.map(({id,width,height,display})=>({id,width,height,display}))});}
async function locateAssets(){await flush();const result=await command('locateAssets');if(result)await load(result);}
function fitCanvas(){
  if(!canvas.pages.length)return;const page=canvas.pages[canvas.pageIndex],area=$('canvasArea');
  if(autoFit)scale=Math.min((area.clientWidth-70)/page.width,(area.clientHeight-65)/page.height,1.4);
  scale=Math.max(.08,Math.min(3,scale));$('canvas').style.transform=`scale(${scale})`;$('canvasSizer').style.width=page.width*scale+'px';$('canvasSizer').style.height=page.height*scale+'px';$('zoomValue').textContent=Math.round(scale*100)+'%';canvas.setScale(scale);
}
function changeZoom(amount){autoFit=false;scale+=amount;fitCanvas();}
new ResizeObserver(()=>fitCanvas()).observe($('canvasArea'));
function buildThumbnails(){
  thumbnailObserver?.disconnect();thumbnailFrames.clear();$('thumbnails').replaceChildren();show('sidebar',canvas.pages.length>1);
  canvas.pages.forEach((page,index)=>{
    const button=document.createElement('button');button.className='thumbnail'+(index===canvas.pageIndex?' active':'');button.title=`第 ${index+1} 页 · ${page.title}`;button.setAttribute('aria-label',`第 ${index+1} 页`);button.dataset.page=index;
    const shell=document.createElement('div');shell.className='thumb-frame';const viewport=document.createElement('div');viewport.className='thumb-viewport';shell.append(viewport);
    const numbers=document.createElement('div');numbers.className='thumb-number';const number=document.createElement('span');number.textContent=String(index+1).padStart(2,'0');const label=document.createElement('span');label.className='thumb-label';label.textContent=page.title;numbers.append(number,label);button.append(shell,numbers);button.onclick=()=>void task(()=>goPage(index));$('thumbnails').append(button);thumbnailFrames.set(index,{button,shell,viewport});thumbnailObserver.observe(button);
  });
  fitCanvas();
}
let thumbnailObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){const index=Number(entry.target.dataset.page);drawThumbnail(index);}}},{root:$('thumbnails'),rootMargin:'150px'});
function drawThumbnail(index,force=false){
  const record=thumbnailFrames.get(index);if(!record||record.frame&&!force)return;const page=canvas.pages[index];
  if(!record.frame){record.frame=document.createElement('iframe');record.frame.title=`第 ${index+1} 页缩略图`;record.frame.setAttribute('sandbox','allow-same-origin');record.frame.setAttribute('tabindex','-1');record.viewport.append(record.frame);}
  const width=record.shell.clientWidth-4,ratio=width/page.width;record.shell.style.height=Math.min(140,Math.max(55,page.height*ratio+4))+'px';record.frame.style.width=page.width+'px';record.frame.style.height=page.height+'px';record.frame.style.transform=`scale(${ratio})`;record.frame.srcdoc=canvas.thumbnailHTML(index);
}
function scheduleThumbnails(){clearTimeout(thumbnailTimer);thumbnailTimer=setTimeout(()=>{drawThumbnail(canvas.pageIndex,true);const page=canvas.pages[canvas.pageIndex];const heading=page.el.querySelector('h1,h2,h3')?.textContent.trim();if(heading){page.title=heading;const record=thumbnailFrames.get(canvas.pageIndex);if(record)record.button.querySelector('.thumb-label').textContent=heading;}},300);}
function selectionChanged(info){
  clearTimeout(cropTimer);if(cropPending){const pending=cropPending;cropPending=null;void task(pending);}
  selection=info;show('textTools',info?.type==='text');show('imageTools',info?.type==='image');show('cropTools',false);show('selectionHint',!info||info.type==='block'||info.type==='readonly');$('selectionHint').textContent=info?.type==='readonly'?'这类内容暂时只能查看':info?.type==='block'?'已选中内容块 · 拖动边框移动':'单击选中 · 双击改字';
  show('selectParent',!!info?.canParent);show('deleteObject',!!info&&!info.readonly);show('backgroundTool',!!info?.backgroundEditable);
  $('objectStatus').textContent=info?`${info.label}  ·  ${info.width} × ${info.height}`:'';
  if(!info)return;
  if(info.type==='text'){$('fontSize').value=info.fontSize;$('textColor').value=info.color;$('textColor').parentElement.style.setProperty('--swatch',info.color);$('bold').classList.toggle('active',info.bold);$('italic').classList.toggle('active',info.italic);document.querySelectorAll('[data-align]').forEach(button=>button.classList.toggle('active',button.dataset.align===info.align));}
  if(info.type==='image'){$('imageCover').classList.toggle('active',info.fit==='cover');$('imageContain').classList.toggle('active',info.fit!=='cover');}
  $('backgroundColor').value=info.background||'#ffffff';$('backgroundLabel').textContent='底色';
}
function hideMenus(){show('moreMenu',false);show('contextMenu',false);}
function positionMenu(menu,x,y){menu.classList.remove('hidden');menu.style.left=Math.min(x,innerWidth-menu.offsetWidth-12)+'px';menu.style.top=Math.min(y,innerHeight-menu.offsetHeight-12)+'px';}
function openContext(info){
  hideMenus();const menu=$('contextMenu');menu.replaceChildren();const add=(text,action)=>{const button=document.createElement('button');button.textContent=text;button.onclick=()=>{hideMenus();void task(action);};menu.append(button);};
  if(selection?.type==='text')add('修改文字',()=>canvas.startText(canvas.selected));
  if(selection?.type==='image')add('换图…',()=>replaceImage());
  if(selection?.canParent)add('选中整块',()=>canvas.selectParent());
  if(selection&&!selection.readonly)add('删除',()=>canvas.deleteSelected());
  if(info.candidates.length>1){menu.append(document.createElement('hr'));const label=document.createElement('span');label.className='muted';label.textContent='选择被遮挡内容';menu.append(label);for(const candidate of info.candidates)add(candidate.label,()=>canvas.select(canvas.find(candidate.id)));}
  if(!menu.children.length)add('当前页背景色…',()=>pageBackground());positionMenu(menu,info.x,info.y);
}
async function replaceImage(){await canvas.finishText();const selected=canvas.selected;const result=await command('selectImage');if(result&&selected===canvas.selected)await canvas.replaceImage(result.url);}
function pageBackground(){forcePageBackground=true;$('backgroundColor').click();}
function openHelp(){$('helpDialog').showModal();}
async function shortcut(key,shift){
  if(key==='o')await open();else if(key==='s')await save(shift?'as':'save');else if(key==='z')await history(shift?'redo':'undo');else if(key==='y')await history('redo');else if(key==='play')await play();
}
$('open').onclick=$('homeOpen').onclick=()=>void task(()=>open());$('sample').onclick=()=>void task(()=>open({sample:true}));
$('homeButton').onclick=()=>void task(()=>home());$('homeHelp').onclick=()=>openHelp();$('previousPage').onclick=()=>void task(()=>goPage(canvas.pageIndex-1));$('nextPage').onclick=()=>void task(()=>goPage(canvas.pageIndex+1));
$('save').onclick=()=>void task(()=>save());$('undo').onclick=()=>void task(()=>history('undo'));$('redo').onclick=()=>void task(()=>history('redo'));$('play').onclick=()=>void task(()=>play());
$('more').onclick=event=>{event.stopPropagation();const visible=$('moreMenu').classList.contains('hidden');hideMenus();if(visible)positionMenu($('moreMenu'),innerWidth-265,66);};
$('moreMenu').onclick=event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;hideMenus();
  void task(async()=>{if(action==='save-as')await save('as');if(action==='overwrite')await save('overwrite');if(action==='show-file')await command('showFile');if(action==='play-first')await play(true);if(action==='background')pageBackground();if(action==='resources')await locateAssets();if(action==='reload'){await flush();const result=await command('reload');if(result)await load(result);}if(action==='help')openHelp();});
};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.menu')&&event.target!==$('more'))hideMenus();});
// Keep the in-document text selection while using a formatting button.
$('contextBar').addEventListener('pointerdown',event=>{canvas.saveRange();if(event.target.closest('button'))event.preventDefault();});
$('fontSize').onchange=()=>void task(async()=>{const value=Math.max(6,Math.min(300,Number($('fontSize').value)||24));await canvas.textStyle('font-size',value+'px');});
$('fontSize').onkeydown=event=>{if(event.key==='Enter'){$('fontSize').blur();canvas.restoreRange();}};
$('textColor').oninput=()=>{$('textColor').parentElement.style.setProperty('--swatch',$('textColor').value);};
$('textColor').onchange=()=>void task(()=>canvas.textStyle('color',$('textColor').value));
$('bold').onclick=()=>void task(()=>canvas.textStyle('font-weight',selection?.bold?'normal':'bold'));
$('italic').onclick=()=>void task(()=>canvas.textStyle('font-style',selection?.italic?'normal':'italic'));
document.querySelectorAll('[data-align]').forEach(button=>button.onclick=()=>void task(()=>canvas.textStyle('text-align',button.dataset.align)));
$('replaceImage').onclick=()=>void task(()=>replaceImage());$('imageContain').onclick=()=>void task(()=>canvas.imageFit('contain'));$('imageCover').onclick=()=>void task(()=>canvas.imageFit('cover'));
$('cropImage').onclick=()=>{show('imageTools',false);show('cropTools');const values=(selection?.position||'50% 50%').split(/\s+/);$('cropX').value=values[0]?.endsWith('%')?parseFloat(values[0]):50;$('cropY').value=values[1]?.endsWith('%')?parseFloat(values[1]):50;};$('cropDone').onclick=()=>{show('cropTools',false);show('imageTools');};
let cropTimer,cropPending;for(const id of ['cropX','cropY']){
  const change=()=>{const el=canvas.selected,x=$('cropX').value,y=$('cropY').value;clearTimeout(cropTimer);cropPending=()=>canvas.imagePosition(x,y,el);};
  $(id).oninput=()=>{change();cropTimer=setTimeout(()=>{const pending=cropPending;cropPending=null;if(pending)void task(pending);},80);};
  $(id).onchange=()=>{change();const pending=cropPending;cropPending=null;void task(pending);};
}
$('backgroundColor').onchange=()=>{const page=forcePageBackground;forcePageBackground=false;void task(()=>canvas.background($('backgroundColor').value,page));};
$('selectParent').onclick=()=>void task(()=>canvas.selectParent());$('deleteObject').onclick=()=>void task(()=>canvas.deleteSelected());
$('zoomOut').onclick=()=>changeZoom(-.1);$('zoomIn').onclick=()=>changeZoom(.1);$('fit').onclick=$('zoomValue').onclick=()=>{autoFit=true;fitCanvas();};
$('alertAction').onclick=()=>void task(async()=>alertAction?.());$('alertDismiss').onclick=()=>{show('alertBar',false);fitCanvas();};
$('closeHelp').onclick=()=>$('helpDialog').close();
$('restore').onclick=()=>void task(async()=>{const result=await command('restore');$('recoveryDialog').close();if(result)await load(result);});
$('discardRecovery').onclick=()=>void task(async()=>{await command('discardRecovery');$('recoveryDialog').close();if(state?.openArgument)await open({argument:true});});
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(document.querySelector('dialog[open]'))return;
  if(event.target.matches('input,textarea')&&(event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase()))return;
  if((event.ctrlKey||event.metaKey)&&['o','s','z','y'].includes(event.key.toLowerCase())){event.preventDefault();void task(()=>shortcut(event.key.toLowerCase(),event.shiftKey));}
  else if(event.key==='F5'){event.preventDefault();void task(()=>play());}
  else if(event.key==='Escape')hideMenus();
  else if(state?.document&&!event.target.matches('input,textarea,select')&&!document.querySelector('dialog[open]'))canvas.onKey(event);
});
for(const target of [window]){
  target.addEventListener('dragenter',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();dragDepth++;show('dropOverlay');}});
  target.addEventListener('dragover',event=>event.preventDefault());
  target.addEventListener('dragleave',event=>{event.preventDefault();dragDepth--;if(dragDepth<=0)show('dropOverlay',false);});
  target.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;show('dropOverlay',false);openDropped([...event.dataTransfer.files]);});
}
function openDropped(files){const file=files.find(file=>/\.html?$/i.test(file.name));if(!file){toast('请拖入一个 HTML 或 HTM 文件。');return;}void task(()=>open({path:window.studio.droppedPath(file)}));}
window.studio.onEvent(event=>{
  if(event.type==='state')updateState(event.data);
  else if(event.type==='notice')toast(event.data.message,true);
  else if(event.type==='player-closed')void task(()=>goPage(event.data.page));
  else if(event.type==='close-request')void task(async()=>{await flush();await command('close');});
  else if(event.type==='open-request')void task(()=>open({argument:true}));
});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();errorMessage(event.reason);});
void task(async()=>{
  const initial=await command('bootstrap');updateState(initial);
  if(initial.recovery){$('recoveryText').textContent=`${initial.recovery.name} · ${new Date(initial.recovery.time).toLocaleString('zh-CN')}`;$('recoveryDialog').showModal();}
  else if(initial.openArgument)await open({argument:true});
});
