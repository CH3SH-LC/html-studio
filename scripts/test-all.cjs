const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const fixtures=spawnSync(process.execPath,[path.join(__dirname,'fetch-fixtures.cjs'),'--verify'],{cwd:root,stdio:'inherit',windowsHide:true});if(fixtures.status!==0)process.exit(fixtures.status||1);
const units=fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.cjs')).map(name=>'tests/'+name);
const suites=[['--test',...units],['tests/desktop.cjs'],['tests/advanced.cjs'],['tests/text-input.cjs'],['tests/readiness.cjs'],['tests/real-decks.cjs']];
for(const args of suites){console.log('\nRunning '+args.join(' '));const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
