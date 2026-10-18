const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const dest=path.join(root,'samples','reveal');fs.mkdirSync(dest,{recursive:true});
for(const name of ['reveal.css','reveal.js'])fs.copyFileSync(path.join(root,'node_modules','reveal.js','dist',name),path.join(dest,name));
fs.copyFileSync(path.join(root,'node_modules','reveal.js','LICENSE'),path.join(dest,'LICENSE'));
// Application icons are committed source assets; normal builds need no image tooling.
