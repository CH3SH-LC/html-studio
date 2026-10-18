const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const output=path.join(root,'dist',`HTML-Studio-${version}-win-x64`),zip=output+'.zip';
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'archive.ps1'),'-Directory',output,'-Archive',zip],{windowsHide:true,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
const bytes=fs.readFileSync(zip);const release={version,platform:'win32-x64',archive:path.basename(zip),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),created:new Date().toISOString()};
fs.writeFileSync(path.join(root,'dist','release.json'),JSON.stringify(release,null,2));console.log(JSON.stringify(release));
