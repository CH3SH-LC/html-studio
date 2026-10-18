'use strict';
// Explicit publication boundary: no profiles, external papers, local reports or binaries.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=['.gitignore','.gitattributes','LICENSE','README.md','CONTRIBUTING.md','CHANGELOG.md','package.json','package-lock.json','THIRD-PARTY-NOTICES.txt','使用说明.txt','启动 HTML Studio.cmd','启动 HTML Studio.vbs','docs/08-真实AI成稿兼容性验收.md','research/real-decks/README.md','research/real-decks/provenance.json'];
function walk(dir){for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isSymbolicLink())throw new Error('No symlinks in release: '+name);if(item.isDirectory())walk(name);else files.push(name);}}
for(const dir of ['src','scripts','tests','samples','.github','docs/screenshots'])walk(dir);
files.sort();
for(const file of files){
  const bytes=fs.readFileSync(path.join(root,file));
  if(bytes.length>4*1024*1024)throw new Error('Unexpected large source file: '+file);
  if(/\.(?:png|ico)$/.test(file))continue;
  const text=bytes.toString('utf8');
  if(/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|sk-[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(text))throw new Error('Credential-like content: '+file);
  if(/[A-Z]:[\\/]Users[\\/][^\s/'"\\]+[\\/]/i.test(text)||/[A-Z]:[\\/]CH3SH[\\/]/i.test(text))throw new Error('Machine-specific path: '+file);
}
if(process.argv.includes('--check')){
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
  const missing=files.filter(f=>!tracked.includes(f)),extra=tracked.filter(f=>!files.includes(f));
  if(missing.length||extra.length)throw new Error(JSON.stringify({missing,extra}));
  console.log(`Public source allowlist verified: ${files.length} files.`);
}else if(process.argv.includes('--stage')){
  execFileSync('git',['add','--',...files],{cwd:root,stdio:'inherit'});
  console.log(`Staged ${files.length} reviewed public files.`);
}else console.log(files.join('\n'));
