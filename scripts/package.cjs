const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');const manifest=require('../package.json');const output=path.join(root,'dist',`HTML-Studio-${manifest.version}-win-x64`);const runtime=path.join(root,'.runtime','electron');
if(!fs.existsSync(path.join(runtime,'electron.exe')))throw new Error('缺少 Windows Electron 运行时。');
if(fs.readFileSync(path.join(runtime,'version'),'utf8').trim()!=='43.1.0')throw new Error('运行时版本不符，请执行 npm run setup。');
fs.mkdirSync(output,{recursive:true});
for(const name of fs.readdirSync(runtime)){
  if(name==='electron.exe')fs.copyFileSync(path.join(runtime,name),path.join(output,'HTML Studio.exe'));
  else if(name==='resources'){
    fs.mkdirSync(path.join(output,'resources'),{recursive:true});
    for(const resource of fs.readdirSync(path.join(runtime,name))){if(resource!=='default_app.asar')fs.cpSync(path.join(runtime,name,resource),path.join(output,name,resource),{recursive:true});}
  }else fs.cpSync(path.join(runtime,name),path.join(output,name),{recursive:true});
}
const appDir=path.join(output,'resources','app');fs.mkdirSync(appDir,{recursive:true});
for(const folder of ['src','samples'])fs.cpSync(path.join(root,folder),path.join(appDir,folder),{recursive:true});
fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:manifest.name,productName:manifest.productName,version:manifest.version,main:manifest.main,description:manifest.description},null,2));
for(const name of ['parse5','entities'])fs.cpSync(path.join(root,'node_modules',name),path.join(appDir,'node_modules',name),{recursive:true});
for(const file of ['使用说明.txt','THIRD-PARTY-NOTICES.txt'])fs.copyFileSync(path.join(root,file),path.join(output,file));
const launcher=`@echo off\r\nstart "" "%~dp0dist\\HTML-Studio-${manifest.version}-win-x64\\HTML Studio.exe" %*\r\n`;
fs.writeFileSync(path.join(root,'启动 HTML Studio.cmd'),launcher);
fs.writeFileSync(path.join(output,'启动 HTML Studio.cmd'),'@echo off\r\nstart "" "%~dp0HTML Studio.exe" %*\r\n');
fs.writeFileSync(path.join(root,'启动 HTML Studio.vbs'),`Set fs = CreateObject("Scripting.FileSystemObject")\r\nSet shell = CreateObject("WScript.Shell")\r\nroot = fs.GetParentFolderName(WScript.ScriptFullName)\r\nexe = fs.BuildPath(root, "dist\\HTML-Studio-${manifest.version}-win-x64\\HTML Studio.exe")\r\nshell.Run Chr(34) & exe & Chr(34), 1, False\r\n`);
const {spawnSync}=require('node:child_process');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const ps=`$link=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(path.join(root,'HTML Studio.lnk'))}); $link.TargetPath=${quote(path.join(output,'HTML Studio.exe'))}; $link.WorkingDirectory=${quote(output)}; $link.Arguments=''; $link.IconLocation=${quote(path.join(output,'resources','app','src','ui','icon.ico'))}; $link.Save()`;
const shortcut=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
if(shortcut.status!==0)throw new Error(shortcut.stderr||'无法更新启动快捷方式');
require('./finalize.cjs');
