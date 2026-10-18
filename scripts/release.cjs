const {spawnSync}=require('node:child_process');const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const script of ['fetch-fixtures.cjs','runtime.cjs','package.cjs','test-all.cjs','finalize.cjs','archive.cjs']){const result=spawnSync(process.execPath,[path.join(__dirname,script)],{cwd:root,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
