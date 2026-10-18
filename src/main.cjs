'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, session, Menu, shell, nativeTheme, screen, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SourceDocument, decodeHTML } = require('./document.cjs');
const { AssetGraph, MIME, hash, within } = require('./resources.cjs');
const { SourceHistory } = require('./history.cjs');
const { openDocument } = require('./bundled-document.cjs');

app.setName('HTML Studio');
app.disableHardwareAcceleration();
if (process.env.HTML_STUDIO_PROFILE) app.setPath('userData',path.resolve(process.env.HTML_STUDIO_PROFILE));
app.setAppLogsPath(path.join(app.getPath('userData'),'logs'));
app.commandLine.appendSwitch('log-file',path.join(app.getPath('logs'),'chromium.log'));
const singleInstance=app.requestSingleInstanceLock();
if(!singleInstance)app.quit();
app.on('second-instance',(_event,argv)=>{const file=argv.find(a=>/\.html?$/i.test(a)&&fs.existsSync(a));if(file){openArgument=file;send('open-request');}if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.focus();}});
protocol.registerSchemesAsPrivileged([
  {scheme:'studio',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}},
  {scheme:'studio-doc',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}
]);
let mainWindow, playerWindow, current, canClose=false, watching=null, recoveryTimer=null;
const grants = new Map();
const profileFile = name => path.join(app.getPath('userData'),name);
const uiRoot = path.join(__dirname,'ui');
const settings = { recent:[], owned:[] };
let openArgument = process.argv.find(a=>/\.html?$/i.test(a) && fs.existsSync(a));
const readJSON = (file, fallback=null) => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } };
function atomicWrite(file, data, expected) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp = path.join(path.dirname(file),`.html-studio-${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor=fs.openSync(temp,'wx'); fs.writeFileSync(descriptor,data); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor=null;
    if (expected !== undefined && diskHash(file) !== expected) throw Object.assign(new Error('文件刚刚被其他软件修改，请另存为以保留两个版本。'),{code:'CONFLICT'});
    fs.renameSync(temp,file);
  } finally { if(descriptor!=null)fs.closeSync(descriptor); if(fs.existsSync(temp))fs.unlinkSync(temp); }
}
const diskHash = file => { try { return hash(fs.readFileSync(file)); } catch { return null; } };
const send = (type,data) => { if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('studio:event',{type,data}); };
let settingsWarning=false;
function persistSettings() {
  try{atomicWrite(profileFile('settings.json'),JSON.stringify(settings,null,2));}
  catch(error){if(!settingsWarning){settingsWarning=true;send('notice',{message:'文稿不受影响，但最近文件列表暂时无法更新。',detail:error.message});}}
}
function recent(file) {
  settings.recent=[file,...settings.recent.filter(x=>x.toLowerCase()!==file.toLowerCase())].slice(0,10);
  persistSettings();
}
function publicRecent() {return settings.recent.map((file,index)=>({index,name:path.basename(file),folder:path.dirname(file),exists:fs.existsSync(file)}));}
function isDirty() {return !!current && current.doc.clean() !== current.savedText;}
function summary(extra={}) {
  if(!current)return {document:null,recent:publicRecent(),...extra};
  return {document:{name:path.basename(current.currentPath),file:current.currentPath,origin:current.originPath,dirty:isDirty(),owned:current.owned,revision:current.revision,canUndo:current.history.canUndo,canRedo:current.history.canRedo,page:current.page,conflict:current.conflict,encoding:current.encoding,stylePriority:current.doc.stylePriority??'important',resources:current.assets.report()},recent:publicRecent(),...extra};
}
function renderState() {
  current.assets.resetReport();
  const html = current.assets.preview(current.doc.editingHTML());
  return summary({html,attribute:current.doc.attribute,attributes:nodeAttributes()});
}
function nodeAttributes(){return Object.fromEntries([...current.doc.nodes.keys()].map(id=>[id,current.doc.nodeInfo(id)]));}
function rememberRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer=setTimeout(()=>{
    try {
      if(!current || !isDirty()) {clearRecovery();return;}
      atomicWrite(profileFile('recovery.json'),JSON.stringify({version:2,originPath:current.originPath,currentPath:current.currentPath,baseFile:current.assets.file,assetRoots:current.assets.approvedRoots.slice(1),encoding:current.encoding,bom:current.bom,working:current.doc.clean(),savedText:current.savedText,owned:current.owned,fingerprint:current.fingerprint,originFingerprint:current.originFingerprint,page:current.page,time:Date.now()}));
    } catch(error){send('notice',{message:'恢复记录暂时无法写入，请及时保存文稿。',detail:error.message});}
  },450);
}
function clearRecovery() { clearTimeout(recoveryTimer);const file=profileFile('recovery.json');if(fs.existsSync(file))fs.unlinkSync(file); }
function makeSession(file, text, originalBytes, options={}) {
  const token=crypto.randomBytes(18).toString('hex');
  const doc=openDocument(text);
  const assets=new AssetGraph(options.baseFile||file,token);
  if(doc.bundle)assets.embeddedReferences=new Set(doc.bundle.assets.keys());
  for(const root of options.assetRoots||[]){if(fs.existsSync(root))assets.approveFolder(root);}
  grants.set(token,{assets});
  const entry={doc,assets,token,originPath:options.originPath||file,currentPath:file,originalBytes,originalText:options.originalText??text,encoding:options.encoding||'utf-8',bom:options.bom||false,savedText:options.savedText??text,owned:options.owned??settings.owned.some(x=>x.toLowerCase()===file.toLowerCase()),fingerprint:Object.hasOwn(options,'fingerprint')?options.fingerprint:diskHash(file),originFingerprint:Object.hasOwn(options,'originFingerprint')?options.originFingerprint:diskHash(options.originPath||file),history:new SourceHistory(),revision:0,page:options.page||0,conflict:false};
  return entry;
}
async function loadFile(file) {
  file=path.resolve(file);
  if(!/\.html?$/i.test(file))throw new Error('请选择 HTML 或 HTM 演示稿。');
  const bytes=fs.readFileSync(file);const decoded=decodeHTML(bytes);
  const next=makeSession(file,decoded.text,bytes,decoded);
  try{next.assets.preview(next.doc.editingHTML());if(!await confirmLeave()){grants.delete(next.token);return null;}}
  catch(error){grants.delete(next.token);throw error;}
  if(current)grants.delete(current.token);
  current=next;
  clearRecovery();recent(file);startWatcher();
  return renderState();
}
function startWatcher() {
  clearInterval(watching);
  watching=setInterval(()=>{
    if(!current)return;
    const changed=diskHash(current.currentPath)!==current.fingerprint;
    if(changed!==current.conflict){current.conflict=changed;send('state',summary());}
  },1800);
}
function trusted(event) {
  return mainWindow && event.sender===mainWindow.webContents && event.senderFrame===mainWindow.webContents.mainFrame && event.senderFrame.url.startsWith('studio://app/');
}
async function chooseOpen() {
  const result=await dialog.showOpenDialog(mainWindow,{title:'打开演示稿',filters:[{name:'HTML 演示稿',extensions:['html','htm']}],properties:['openFile']});
  return result.canceled?null:result.filePaths[0];
}
async function confirmLeave() {
  if(!isDirty())return true;
  const result=await dialog.showMessageBox(mainWindow,{type:'question',title:'保留这次修改吗？',message:'文稿还有未保存的修改',buttons:['保存后继续','放弃修改','取消'],defaultId:0,cancelId:2,noLink:true});
  if(result.response===2)return false;
  if(result.response===0){const saved=await saveDocument('save');if(!saved)return false;}
  return true;
}
function suggestCopy(file) {
  const folder=within(app.getAppPath(),file)?app.getPath('documents'):path.dirname(file);
  const base=path.join(folder,path.basename(file,path.extname(file))+'-修改版');
  let candidate=base+'.html',n=2;
  while(fs.existsSync(candidate))candidate=base+`-${n++}.html`;
  return candidate;
}
async function saveDocument(mode='save') {
  if(!current)return null;
  let target=current.currentPath;
  let expected;
  if(mode==='overwrite') {
    const ask=await dialog.showMessageBox(mainWindow,{type:'warning',title:'覆盖原稿',message:`将替换“${path.basename(current.originPath)}”`,detail:'原稿会被当前修改替换。如需保留原稿，请取消并选择保存副本。',buttons:['取消','覆盖原稿'],defaultId:0,cancelId:0,noLink:true});
    if(ask.response!==1)return null;
    target=current.originPath;expected=current.originFingerprint;
  } else if(mode==='as'||!current.owned) {
    const result=await dialog.showSaveDialog(mainWindow,{title:'保存演示稿副本',defaultPath:suggestCopy(current.currentPath),filters:[{name:'HTML 演示稿',extensions:['html']}],properties:['showOverwriteConfirmation','createDirectory']});
    if(result.canceled||!result.filePath)return null;
    target=result.filePath;if(!/\.html?$/i.test(target))target+='.html';
    if(target.toLowerCase()===current.currentPath.toLowerCase())expected=current.fingerprint;
    else if(target.toLowerCase()===current.originPath.toLowerCase())expected=current.originFingerprint;
    else expected=diskHash(target);
  } else expected=current.fingerprint;
  if(diskHash(target)!==expected)throw Object.assign(new Error('这份文件已被其他软件修改。请使用“另存为”，或载入外部新版本。'),{code:'CONFLICT'});
  let clean=current.doc.clean();
  const exported=current.assets.export(current.doc.content?.()??clean,target);
  if(current.doc.wrap)exported.html=current.doc.wrap(exported.html);
  if(exported.folder) {
    const directory=path.join(path.dirname(target),exported.folder);
    fs.mkdirSync(directory,{recursive:true});
    for(const file of exported.files){
      const destination=path.join(directory,file.name);
      if(fs.existsSync(destination)){
        if(diskHash(destination)!==hash(file.bytes))throw new Error('配套素材目录中存在不同版本，请选择其他保存文件名。');
      }else atomicWrite(destination,file.bytes,null);
    }
  }
  let output=exported.html;
  if(!/^utf-?8$/i.test(current.encoding)) {
    output=output.replace(/(<meta\b[^>]*charset\s*=\s*["']?)[\w-]+/gi,'$1utf-8');
    if(!/<meta\b[^>]*charset/i.test(output))output=output.replace(/<head\b[^>]*>/i,'$&<meta charset="utf-8">');
  }
  let bytes=Buffer.from((current.bom?'\uFEFF':'')+output,'utf8');
  if(clean===current.originalText&&exported.html===clean&&current.originalBytes)bytes=current.originalBytes;
  atomicWrite(target,bytes,expected);
  current.currentPath=target;current.owned=true;current.savedText=clean;current.fingerprint=hash(bytes);current.conflict=false;
  if(target.toLowerCase()===current.originPath.toLowerCase())current.originFingerprint=current.fingerprint;
  settings.owned=[...new Set([...settings.owned,target])].slice(-200);
  current.history.seal();recent(target);
  try{clearRecovery();}catch(error){send('notice',{message:'文稿已保存，但旧的恢复记录未能清理。',detail:error.message});}
  return summary({saved:true,output:{file:target,folder:exported.folder,remote:current.assets.remote.size}});
}

function configureSession(ses) {
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',event=>event.preventDefault());
  ses.webRequest.onBeforeRequest({urls:['file://*/*']},(_details,callback)=>callback({cancel:true}));
  ses.protocol.handle('studio-doc',request=>{
    try {
      const url=new URL(request.url);const grant=grants.get(url.hostname);
      if(!grant)return new Response('已关闭的文稿',{status:404});
      if(url.pathname==='/presentation.html'&&grant.presentation)return new Response(grant.presentation,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self' https: http: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: blob:; style-src 'self' 'unsafe-inline' https: http: blob:; object-src 'none'; frame-src https: http:; form-action 'none'; base-uri 'none'"}});
      if(!url.pathname.startsWith('/assets/'))return new Response('',{status:404});
      const asset=grant.assets.assets.get(decodeURIComponent(url.pathname.slice(8)));
      if(!asset?.bytes)return new Response('',{status:404});
      return new Response(asset.bytes,{headers:{'Content-Type':asset.mime,'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('',{status:404});}
  });
}
async function safeExternal(url) {
  if(!/^https?:\/\//i.test(url))return;
  const parsed=new URL(url);
  const answer=await dialog.showMessageBox(playerWindow||mainWindow,{type:'question',message:`在浏览器中打开 ${parsed.hostname}？`,buttons:['打开','取消'],defaultId:1,cancelId:1,noLink:true});
  if(answer.response===0)await shell.openExternal(parsed.href);
}
function lockWindow(win, allowExternal=false) {
  win.webContents.setWindowOpenHandler(({url})=>{if(allowExternal)void safeExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{event.preventDefault();if(allowExternal)void safeExternal(url);});
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('content-bounds-updated',event=>event.preventDefault());
}
async function play(payload) {
  if(!current)return false;
  if(playerWindow&&!playerWindow.isDestroyed()){playerWindow.focus();return true;}
  const pages=(payload.pages||[]).filter(p=>current.doc.nodes.has(p.id)).map(p=>({id:p.id,width:Math.max(100,Math.min(10000,p.width)),height:Math.max(100,Math.min(20000,p.height)),display:['flex','grid','block','inline-block','table'].includes(p.display)?p.display:'block'}));
  const start=Math.max(0,Math.min(pages.length-1,Number(payload.page)||0));
  const token=crypto.randomBytes(18).toString('hex');
  const assets=new AssetGraph(current.assets.file,token);for(const root of current.assets.approvedRoots.slice(1))assets.approveFolder(root);
  assets.embeddedReferences=new Set(current.assets.embeddedReferences);
  const presentation=assets.preview(current.doc.presentationHTML?.()??current.doc.source);
  grants.set(token,{assets,presentation});
  const partition=`play-${token}`;const ses=session.fromPartition(partition);configureSession(ses);
  playerWindow=new BrowserWindow({title:'演示 · HTML Studio',width:1280,height:760,backgroundColor:'#101418',fullscreen:true,autoHideMenuBar:true,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
  lockWindow(playerWindow,true);
  let lastPage=start,poll;
  playerWindow.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();playerWindow?.close();}
  });
  playerWindow.on('closed',()=>{
    playerWindow=null;grants.delete(token);clearInterval(poll);send('player-closed',{page:lastPage});mainWindow?.focus();
  });
  const script=fs.readFileSync(path.join(__dirname,'player.js'),'utf8');
  await playerWindow.loadURL(`studio-doc://${token}/presentation.html`);
  if(playerWindow&&!playerWindow.isDestroyed())await playerWindow.webContents.executeJavaScript(`(${script})(${JSON.stringify({attribute:current.doc.attribute,pages,start})})`);
  poll=setInterval(async()=>{try{if(playerWindow&&!playerWindow.isDestroyed()){const value=await playerWindow.webContents.executeJavaScript('window.__htmlStudioPage ?? 0');if(Number.isInteger(value))lastPage=Math.max(0,Math.min(Math.max(0,pages.length-1),value));}}catch{}},300);
  return true;
}

const commands={
  async bootstrap(){ const recovery=readJSON(profileFile('recovery.json'));return summary({recovery:recovery?{name:path.basename(recovery.currentPath),time:recovery.time}:null,openArgument:!!openArgument}); },
  async open(payload){
    let file=payload?.path;
    if(payload?.recent!==undefined)file=settings.recent[payload.recent];
    if(payload?.argument){file=openArgument;openArgument=null;}
    if(payload?.sample)file=path.join(app.getAppPath(),'samples','欢迎使用.html');
    if(!file||!fs.existsSync(file))file=await chooseOpen();
    return file?loadFile(file):null;
  },
  async commit(payload){
    if(!current)throw new Error('请先打开演示稿。');
    if(payload.revision!==current.revision)throw new Error('文稿状态已变化，请稍后重试。');
    const before=current.doc.source;
    try{current.doc.apply(payload.operation);}catch(error){current.doc.setSource(before);throw error;}
    if(before!==current.doc.source){
      current.history.push(before,current.doc.source,{page:payload.page||0,label:payload.label||'修改内容',merge:payload.merge});
      current.page=payload.page||0;current.revision++;rememberRecovery();
    }
    return summary({attributes:nodeAttributes()});
  },
  async history(payload){
    if(!current)return null;
    const result=current.history.move(current.doc.source,payload.direction);if(!result)return null;
    current.doc.setSource(result.source);current.page=result.page;current.revision++;rememberRecovery();return renderState();
  },
  async save(payload){return saveDocument(payload?.mode);},
  async selectImage(){
    const result=await dialog.showOpenDialog(mainWindow,{title:'替换图片',filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}],properties:['openFile']});
    if(result.canceled)return null;
    const file=result.filePaths[0],bytes=fs.readFileSync(file),ext=path.extname(file).toLowerCase();
    if(bytes.length>25*1024*1024)throw new Error('图片超过 25 MB，请先缩小图片文件。');
    if(!['.png','.jpg','.jpeg','.webp'].includes(ext)||nativeImage.createFromBuffer(bytes).isEmpty())throw new Error('这份文件不是可用的 PNG、JPEG 或 WebP 图片。');
    return {url:`data:${MIME[ext]};base64,${bytes.toString('base64')}`,name:path.basename(file)};
  },
  async locateAssets(){
    if(!current)return null;
    const result=await dialog.showOpenDialog(mainWindow,{title:'选择素材所在的文件夹',properties:['openDirectory']});
    if(result.canceled)return null;
    current.assets.approveFolder(result.filePaths[0]);rememberRecovery();return renderState();
  },
  async play(payload){return play(payload);},
  async page(payload){if(current)current.page=Math.max(0,Number(payload.page)||0);return true;},
  async reload(){if(!current)return null;return loadFile(current.currentPath);},
  async restore(){
    const recovery=readJSON(profileFile('recovery.json'));if(!recovery)return null;
    if(typeof recovery.working!=='string'||typeof recovery.currentPath!=='string')throw new Error('恢复记录不完整，正式文件没有受到影响。');
    if(current)grants.delete(current.token);
    current=makeSession(recovery.currentPath,recovery.working,null,{...recovery,originalText:recovery.savedText});
    current.conflict=diskHash(current.currentPath)!==current.fingerprint;
    startWatcher();rememberRecovery();return renderState();
  },
  async discardRecovery(){clearRecovery();return true;},
  async home(){if(!await confirmLeave())return null;clearRecovery();if(current)grants.delete(current.token);current=null;clearInterval(watching);return summary();},
  async state(){return current?renderState():summary();},
  async close(){if(!await confirmLeave())return false;clearRecovery();canClose=true;mainWindow.close();return true;},
  async showFile(){if(current)shell.showItemInFolder(current.currentPath);return true;}
};
let commandQueue=Promise.resolve();
ipcMain.handle('studio:command',async(event,name,payload)=>{
  if(!trusted(event)||!Object.hasOwn(commands,name))return {ok:false,error:'无法执行此操作。'};
  const result=commandQueue.then(async()=>{try{return {ok:true,result:await commands[name](payload)};}catch(error){return {ok:false,error:error.message,code:error.code||'ERROR'};}});
  commandQueue=result.catch(()=>{});return result;
});

app.whenReady().then(async()=>{
  if(!singleInstance)return;
  fs.mkdirSync(app.getPath('userData'),{recursive:true});
  const stored=readJSON(profileFile('settings.json'),{});settings.recent=Array.isArray(stored.recent)?stored.recent.filter(x=>typeof x==='string').slice(0,10):[];settings.owned=Array.isArray(stored.owned)?stored.owned.filter(x=>typeof x==='string'):[];
  nativeTheme.themeSource='light';Menu.setApplicationMenu(null);
  configureSession(session.defaultSession);
  protocol.handle('studio',request=>{
    try{
      const url=new URL(request.url);if(url.hostname!=='app')return new Response('',{status:404});
      const file=path.resolve(uiRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!within(uiRoot,file)||!fs.statSync(file).isFile())return new Response('',{status:404});
      const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' studio-doc: https: http: data:; img-src 'self' studio-doc: data: blob: https: http:; font-src studio-doc: data: https: http:; media-src studio-doc: data: https: http:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      return new Response(fs.readFileSync(file),{headers:{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp}});
    }catch{return new Response('',{status:404});}
  });
  const area=screen.getPrimaryDisplay().workAreaSize;
  const bounds=stored.window||{};
  mainWindow=new BrowserWindow({title:'HTML Studio',width:Math.min(area.width,Math.max(960,Number(bounds.width)||1360)),height:Math.min(area.height,Math.max(640,Number(bounds.height)||880)),minWidth:Math.min(960,area.width),minHeight:Math.min(640,area.height),backgroundColor:'#f5f5f2',show:false,autoHideMenuBar:true,icon:path.join(uiRoot,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  lockWindow(mainWindow);
  mainWindow.on('close',event=>{if(!canClose){event.preventDefault();send('close-request');}});
  mainWindow.once('ready-to-show',()=>{if(bounds.maximized)mainWindow.maximize();mainWindow.show();});
  mainWindow.on('closed',()=>{playerWindow?.close();});
  mainWindow.on('close',()=>{settings.window={...mainWindow.getNormalBounds(),maximized:mainWindow.isMaximized()};persistSettings();});
  mainWindow.webContents.on('render-process-gone',()=>{canClose=true;dialog.showMessageBox(mainWindow,{type:'error',message:'编辑窗口意外停止',detail:'请重新打开应用，恢复已记录的修改。正式文件不会被覆盖。',buttons:['重新打开','退出']}).then(({response})=>{if(response===0)app.relaunch();app.exit(1);});});
  await mainWindow.loadURL('studio://app/index.html');
}).catch(error=>{dialog.showErrorBox('HTML Studio 无法启动',error.message);app.exit(1);});
app.on('window-all-closed',()=>{clearInterval(watching);if(process.platform!=='darwin')app.quit();});
process.on('uncaughtException',error=>{console.error(error);if(mainWindow&&!mainWindow.isDestroyed())send('notice',{message:'操作未完成，修改仍保留在当前窗口。',detail:error.message});});
