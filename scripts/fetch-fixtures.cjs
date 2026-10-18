'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..','research','real-decks');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'provenance.json'),'utf8'));
const verifyOnly=process.argv.includes('--verify');
function verify(bytes,entry){
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const blob=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if(bytes.length!==entry.bytes||sha256!==entry.sha256||blob!==entry.gitBlob)throw new Error(`Integrity mismatch: ${entry.file}`);
}
function destination(entry){
  if(typeof entry.file!=='string'||entry.file.includes('\\')||entry.file.split('/').some(p=>!p||p==='..'||p==='.')||path.isAbsolute(entry.file))throw new Error('Invalid fixture path');
  const pin=manifest.pins.find(p=>entry.file.startsWith(p.dir+'/'));
  if(!pin||!/^[a-f0-9]{40}$/.test(pin.commit))throw new Error('Missing pinned revision');
  const expected=`https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/${entry.file.slice(pin.dir.length+1)}`;
  if(entry.url!==expected)throw new Error('Fixture URL does not match pinned repository');
  const file=path.resolve(root,entry.file);
  if(!file.startsWith(root+path.sep))throw new Error('Fixture path escapes corpus');
  return file;
}
async function download(entry){
  let last;
  for(let attempt=0;attempt<3;attempt++){
    try{const response=await fetch(entry.url,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());verify(bytes,entry);return bytes;}
    catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
  }
  throw new Error(`Cannot fetch ${entry.file}: ${last.message}`);
}
async function main(){
  let downloaded=0;
  for(const entry of manifest.files){
    const file=destination(entry);
    if(fs.existsSync(file)){verify(fs.readFileSync(file),entry);continue;}
    if(verifyOnly)throw new Error('Missing external test corpus. Run npm run fetch:fixtures first.');
    const bytes=await download(entry);fs.mkdirSync(path.dirname(file),{recursive:true});
    // Exclusive creation preserves any file another process placed here meanwhile.
    fs.writeFileSync(file,bytes,{flag:'wx'});downloaded++;
  }
  console.log(`Verified ${manifest.files.length} pinned upstream files (${downloaded} downloaded).`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
