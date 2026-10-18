const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');const executable=path.join(root,'.runtime','electron','electron.exe');
if(!fs.existsSync(executable)){console.error('开发运行环境尚未准备。请直接运行 dist 中的 HTML Studio.exe。');process.exit(1);}
const env={...process.env,HTML_STUDIO_PROFILE:path.join(root,'.runtime','development-profile')};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[root,...process.argv.slice(2)],{cwd:root,env,stdio:'inherit',windowsHide:false});child.on('exit',code=>process.exit(code||0));
