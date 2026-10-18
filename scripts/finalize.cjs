const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');const version=require('../package.json').version;const output=path.join(root,'dist',`HTML-Studio-${version}-win-x64`);
// Finalize documentation and the self-excluding manifest; executable code is copied by package.cjs.
for(const name of ['使用说明.txt','THIRD-PARTY-NOTICES.txt'])fs.copyFileSync(path.join(root,name),path.join(output,name));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(output,'HTML-STUDIO-LICENSE.txt'));
const report=path.join(root,'docs','08-真实AI成稿兼容性验收.md');
if(fs.existsSync(report))fs.copyFileSync(report,path.join(output,'验收记录.md'));
const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name!=='SHA256SUMS.json'&&!entry.name.endsWith('.log')){const bytes=fs.readFileSync(file);files.push({path:path.relative(output,file).split(path.sep).join('/'),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}walk(output);fs.writeFileSync(path.join(output,'SHA256SUMS.json'),JSON.stringify({version,files},null,2));console.log(JSON.stringify({output,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
