'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version='43.1.0',runtime=path.join(root,'.runtime','electron');
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('此交付脚本面向 Windows x64。');
  if(fs.existsSync(path.join(runtime,'electron.exe'))&&fs.readFileSync(path.join(runtime,'version'),'utf8').trim()===version){console.log('Electron '+version+' 已准备好。');return;}
  const name=`electron-v${version}-win32-x64.zip`,url=`https://github.com/electron/electron/releases/download/v${version}/`;
  const cache=path.join(root,'.cache');fs.mkdirSync(cache,{recursive:true});
  const checks=await fetch(url+'SHASUMS256.txt');if(!checks.ok)throw new Error('下载运行时校验文件失败：'+checks.status);
  const expected=(await checks.text()).split('\n').find(line=>line.trim().endsWith(name))?.split(/\s+/)[0];
  if(!/^[a-f0-9]{64}$/i.test(expected||''))throw new Error('运行时校验文件中找不到目标。');
  let zip=process.env.HTML_STUDIO_RUNTIME_ZIP||path.join(cache,name);
  if(!fs.existsSync(zip)){const response=await fetch(url+name);if(!response.ok)throw new Error('下载运行时失败：'+response.status);fs.writeFileSync(zip,Buffer.from(await response.arrayBuffer()));}
  const actual=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');if(actual!==expected)throw new Error('运行时校验不通过，请移走缓存 ZIP 后重试。');
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const script=`Expand-Archive -LiteralPath ${quote(path.resolve(zip))} -DestinationPath ${quote(runtime)} -Force`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'inherit'});
  if(result.status!==0)throw new Error('解压运行时失败。');console.log('运行时校验并准备完成。');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
