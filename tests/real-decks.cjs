'use strict';
// External, pinned AI outputs. Never rewrite input decks to make this test pass.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {_electron:electron,chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),corpus=path.join(root,'research','real-decks');
const version=process.argv.find(x=>x.startsWith('--version='))?.split('=')[1]||require('../package.json').version;
const baseline=process.argv.includes('--baseline');
const workspace=path.join(root,'test-results','real-decks',`${Date.now()}-${version}`);fs.mkdirSync(workspace,{recursive:true});
const specs=[
  {id:'attention',name:'Attention Is All You Need',file:'paper-master/paper-slides/Attention_Is_All_You_Need.html',pages:15,selector:'.slide'},
  {id:'dialogue',name:'Dialogue Director',file:'paper-master/paper-slides/Dialogue_Director.html',pages:19,selector:'.slide',title:':scope > div.anim[style*="font-size"]'},
  {id:'dysample',name:'DySample: Learning to Upsample',file:'paper-master/paper-slides/DySample_Learning_to_Upsample.html',pages:19,selector:'.slide'},
  {id:'gemini',name:'Gemini Color System (published AI preview)',file:'slide-md/docs/SLIDE-md/SLIDE-md-gemini-color-system/sample.html',pages:6,selector:'section[data-label]',title:'div[style*="font-size"][style*="36px"]',bundle:true}
];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report={version,baseline,started:new Date().toISOString(),workspace,cases:[],errors:[]};
let app,page,browser;
async function dialogs(values){await app.evaluate((_,v)=>Object.assign(global.__dialogs,v),values);}
async function open(file){await dialogs({open:file});await page.locator('#open').click();await page.waitForFunction(n=>document.getElementById('filename').textContent===n,path.basename(file));await page.locator('#loading').waitFor({state:'hidden'});}
async function thumb(index){await page.locator('.thumbnail').nth(index).click();await page.waitForFunction(i=>document.getElementById('pageStatus').textContent.startsWith(`第 ${i+1} /`),index);}
function visibleMetrics(el){
  const w=el.ownerDocument.defaultView,r=el.getBoundingClientRect();let opacity=1,hidden=false;
  for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=w.getComputedStyle(n);opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden')hidden=true;}
  return {text:el.textContent.trim().slice(0,100),opacity,hidden,x:r.x,y:r.y,width:r.width,height:r.height,viewport:[w.innerWidth,w.innerHeight]};
}
async function runCase(spec){
  const dir=path.join(workspace,spec.id);fs.mkdirSync(dir);const original=path.join(corpus,spec.file),originalHash=digest(original);
  const c={...spec,original,originalHash,checks:[],issues:[],screenshots:[],pagesReviewed:[]};report.cases.push(c);
  const check=async(name,fn)=>{try{const detail=await fn();c.checks.push({name,passed:true,detail});console.log(`PASS ${spec.id}: ${name}`);return true;}catch(e){c.checks.push({name,passed:false,error:e.message});console.log(`FAIL ${spec.id}: ${name}: ${e.message.slice(0,200)}`);return false;}};
  const shot=async(name,target=page)=>{const file=path.join(dir,name+'.png');await target.screenshot({path:file,timeout:10000});c.screenshots.push(file);};
  const reference=await browser.newPage({viewport:{width:1280,height:720}});const refErrors=[];reference.on('pageerror',e=>refErrors.push(e.message));
  await check('unmodified upstream opens in independent Edge',async()=>{
    await reference.goto(pathToFileURL(original).href,{waitUntil:'load'});await reference.locator(spec.selector).first().waitFor();
    if(spec.bundle)await reference.locator('deck-stage').waitFor({timeout:15000});
    await reference.waitForTimeout(800);await shot('00-original-edge',reference);return {runtimeErrors:refErrors};
  });
  await check('open original in packaged desktop',async()=>{await open(original);assert.equal(await page.locator('.thumbnail').count(),spec.pages);});
  if(await page.locator('#alertAction').isVisible()&&(await page.locator('#alertAction').textContent())==='定位素材'){
    await check('locate the existing parent asset folder',async()=>{await dialogs({open:path.join(corpus,'paper-master')});await page.locator('#alertAction').click();await page.locator('#loading').waitFor({state:'hidden'});assert.ok(!await page.locator('#alertBar').isVisible(),await page.locator('#alertText').textContent());});
  }
  const count=await page.locator('.thumbnail').count();
  if(count===spec.pages){
    await check('every page displays its headings and existing images',async()=>{
      const defects=[];
      for(let i=0;i<count;i++){
        await thumb(i);const frame=page.frameLocator('#canvas'),slide=frame.locator(spec.selector).nth(i);
        const heads=[];for(const heading of await slide.locator(i===0&&spec.title?spec.title:'h1,h2,h3').all())heads.push(await heading.evaluate(visibleMetrics));
        const images=await slide.locator('img').evaluateAll(els=>els.map(el=>({loaded:el.complete&&el.naturalWidth>0,width:el.naturalWidth,src:el.getAttribute('src')?.slice(0,90)})));
        for(const h of heads)if(h.hidden||h.opacity<.05||h.width<1||h.height<1||h.y< -2||h.y+h.height>h.viewport[1]+2)defects.push({page:i+1,heading:h});
        for(const img of images)if(!img.loaded)defects.push({page:i+1,image:img});
        c.pagesReviewed.push({page:i+1,heads,images});await shot(`page-${String(i+1).padStart(2,'0')}`);
      }
      c.issues.push(...defects);assert.deepEqual(defects,[]);return {pages:count};
    });
    await thumb(0);await shot('01-before-edit');
    const replacement=`${spec.id} · 已验收修改`;
    await check('double click and change real heading text',async()=>{const h=page.frameLocator('#canvas').locator(spec.selector).first().locator(spec.title||'h1,h2,h3').first();await h.dblclick();await page.keyboard.press('Control+A');await page.keyboard.insertText(replacement);await page.locator('#open').focus();assert.equal(await h.textContent(),replacement);});
    let imageIndex=-1;
    for(let i=0;i<count;i++){if(await page.frameLocator('#canvas').locator(spec.selector).nth(i).locator('img').count()){imageIndex=i;break;}}
    c.imagePage=imageIndex+1;
    await check('select existing image and replace through image picker',async()=>{
      assert.ok(imageIndex>=0,'no replaceable image');await thumb(imageIndex);const img=page.frameLocator('#canvas').locator(spec.selector).nth(imageIndex).locator('img').first();
      c.imageSize=await img.evaluate(el=>[el.offsetWidth,el.offsetHeight]);
      await img.click();await dialogs({open:path.join(root,'src','ui','icon.png')});await page.locator('#replaceImage').click();
      await img.evaluate(el=>new Promise((resolve,reject)=>{if(el.getAttribute('src').startsWith('data:image/png')&&el.complete&&el.naturalWidth>0)return resolve();el.onload=resolve;setTimeout(()=>reject(new Error('replacement not loaded')),5000);}));
      assert.match(await img.getAttribute('src'),/^data:image\/png;base64,/);await shot('02-image-edited');
    });
    const output=path.join(dir,'另一个文件夹','修改后的演示稿.html');fs.mkdirSync(path.dirname(output));c.output=output;
    const saved=await check('save copy in a different folder and preserve original',async()=>{
      await dialogs({save:output});await page.locator('#save').click();await page.waitForFunction(()=>['已保存','保存失败'].includes(document.getElementById('saveState').textContent));
      assert.ok(fs.existsSync(output),await page.locator('#toast').textContent());assert.equal(digest(original),originalHash);const data=fs.readFileSync(output,'utf8');assert.ok(data.includes(replacement));assert.ok(!/data-hs-[a-f\d]{12}/.test(data));return {bytes:Buffer.byteLength(data),sha256:digest(output)};
    });
    if(saved){
      await check('reopen copy with edited text and replacement image',async()=>{await open(output);assert.equal(await page.locator('.thumbnail').count(),count);assert.equal(await page.frameLocator('#canvas').locator(spec.selector).first().locator(spec.title||'h1,h2,h3').first().textContent(),replacement);await thumb(imageIndex);const img=page.frameLocator('#canvas').locator(spec.selector).nth(imageIndex).locator('img').first();assert.match(await img.getAttribute('src'),/^data:image\/png/);assert.ok(await img.evaluate(el=>el.naturalWidth>0));await shot('03-reopened');});
      await check('play from selected page, keyboard forward/back/end, return to editor',async()=>{
        const nextWindow=app.waitForEvent('window');await page.locator('#play').click();const player=await nextWindow;
        player.setDefaultTimeout(12000);player.on('pageerror',e=>c.issues.push({playerError:e.message}));await player.bringToFront();
        await app.evaluate(({BrowserWindow})=>{global.__playerKeys=[];for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().startsWith('studio-doc:'))w.webContents.on('before-input-event',(_e,input)=>global.__playerKeys.push({type:input.type,key:input.key}));});
        try{
          await player.waitForFunction(()=>Number.isInteger(window.__htmlStudioPage));await player.waitForFunction(i=>window.__htmlStudioPage===i,imageIndex);await player.waitForTimeout(900);
          c.navigation=await player.evaluate(()=>window.__htmlStudioNavigation);
          const m=await player.locator(spec.selector).nth(imageIndex).locator(imageIndex===0&&spec.title?spec.title:'h1,h2,h3').first().evaluate(visibleMetrics);assert.ok(!m.hidden&&m.opacity>.05,JSON.stringify(m));
          assert.ok(await player.locator(spec.selector).nth(imageIndex).locator('img').first().evaluate(el=>el.naturalWidth>0));await shot('04-player-selected',player);
          if(spec.bundle)assert.deepEqual(await player.locator(spec.selector).nth(imageIndex).locator('img').first().evaluate(el=>[el.offsetWidth,el.offsetHeight]),c.imageSize,'replaced image must retain authored dimensions during component playback');
          await player.keyboard.press('ArrowRight');await player.waitForFunction(i=>window.__htmlStudioPage===i,Math.min(count-1,imageIndex+1));await player.waitForTimeout(900);
          const nextMetrics=await player.locator(spec.selector).nth(Math.min(count-1,imageIndex+1)).locator('h1,h2,h3').first().evaluate(visibleMetrics);assert.ok(!nextMetrics.hidden&&nextMetrics.opacity>.05,JSON.stringify(nextMetrics));
          await player.keyboard.press('ArrowLeft');await player.waitForFunction(i=>window.__htmlStudioPage===i,imageIndex);
          await player.keyboard.press('End');await player.waitForFunction(i=>window.__htmlStudioPage===i,count-1);await player.waitForTimeout(1000);await shot('05-player-last',player);
          const endMetrics=await player.locator(spec.selector).last().locator('h1,h2,h3').first().evaluate(visibleMetrics);assert.ok(!endMetrics.hidden&&endMetrics.opacity>.05,JSON.stringify(endMetrics));
          assert.equal(await player.evaluate(()=>typeof require),'undefined');assert.equal(await player.evaluate(()=>typeof window.studio),'undefined');
        }catch(e){await shot('player-failure',player).catch(()=>{});c.issues.push({playerFailure:e.message,url:player.url(),toast:await page.locator('#toast').textContent()});throw e;}
        finally{if(!player.isClosed()){try{await Promise.all([player.waitForEvent('close',{timeout:4000}),app.evaluate(({BrowserWindow},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);w.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});},player.url())]);c.escapeInput='Electron sendInputEvent (CDP bypasses before-input-event)';}catch(e){c.issues.push({escapeFailure:e.message,keys:await app.evaluate(()=>global.__playerKeys)});await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().startsWith('studio-doc:'))w.close();});}}await page.bringToFront();}
        await page.waitForFunction(i=>document.getElementById('pageStatus').textContent.startsWith(`第 ${i+1} /`),count-1);
      });
      await check('saved copy plays independently in offline Edge',async()=>{
        await reference.context().setOffline(true);await reference.goto(pathToFileURL(output).href,{waitUntil:'load'});if(spec.bundle)await reference.locator('deck-stage').waitFor({timeout:15000});await reference.waitForTimeout(600);
        const first=reference.locator(spec.selector).first().locator(spec.title||'h1,h2,h3').first();assert.equal(await first.textContent(),replacement);
        for(let i=0;i<imageIndex;i++)await reference.keyboard.press('ArrowRight');await reference.waitForTimeout(800);
        const img=reference.locator(spec.selector).nth(imageIndex).locator('img').first();assert.match(await img.getAttribute('src'),/^data:image\/png/);assert.ok(await img.evaluate(el=>el.naturalWidth>0));
        if(spec.bundle)assert.deepEqual(await img.evaluate(el=>[el.offsetWidth,el.offsetHeight]),c.imageSize,'saved replacement must retain dimensions outside editor');
        const m=await reference.locator(spec.selector).nth(imageIndex).locator(imageIndex===0&&spec.title?spec.title:'h1,h2,h3').first().evaluate(visibleMetrics);assert.ok(!m.hidden&&m.opacity>.05,JSON.stringify(m));await shot('06-saved-offline-edge',reference);
        const broken=await reference.locator('img').evaluateAll(els=>els.filter(el=>!el.complete||!el.naturalWidth).map(el=>el.getAttribute('src')));assert.deepEqual(broken,[]);
      });
    }
  }else c.issues.push({reason:'page detection failed; text/image/save/play cannot be meaningfully exercised',actual:count,expected:spec.pages});
  await shot('final-state').catch(()=>{});await reference.close();c.passed=c.checks.every(x=>x.passed)&&!c.issues.length&&count===spec.pages;
  fs.writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));
}
async function main(){
  const env={...process.env,HTML_STUDIO_PROFILE:path.join(workspace,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:path.join(root,'dist',`HTML-Studio-${version}-win-x64`,'HTML Studio.exe'),args:[],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(9000);await page.locator('#homeOpen').waitFor();page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(({dialog})=>{global.__dialogs={};dialog.showOpenDialog=async()=>({canceled:false,filePaths:[global.__dialogs.open]});dialog.showSaveDialog=async()=>({canceled:false,filePath:global.__dialogs.save});dialog.showMessageBox=async()=>({response:1});});
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const spec of specs){try{await runCase(spec);}catch(e){report.errors.push(spec.id+': '+e.stack);console.error(e);}}
  report.passed=report.cases.length===specs.length&&report.cases.every(c=>c.passed)&&!report.errors.length;
  if(!report.passed&&!baseline)process.exitCode=1;
}
main().catch(e=>{report.error=e.stack;process.exitCode=1;}).finally(async()=>{await browser?.close();if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}report.finished=new Date().toISOString();fs.writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'test-results','real-decks','latest.json'),JSON.stringify(report,null,2));console.log('REPORT '+workspace);});
