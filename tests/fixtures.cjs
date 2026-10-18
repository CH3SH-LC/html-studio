const fs=require('node:fs');const path=require('node:path');
function createFixtures(root){
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'assets'),{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');fs.writeFileSync(path.join(root,'assets','image.png'),png);
  fs.writeFileSync(path.join(root,'assets','external.css'),'.external{background:#eaf2e7}.photo{background-image:url(image.png)}');
  const variants=[
    {name:'01-单页语义结构',wrap:x=>`<main>${x}</main>`},
    {name:'02-固定宽高',style:'main{width:1000px;height:600px}',wrap:x=>`<main>${x}</main>`},
    {name:'03-Flex卡片',style:'.cards{display:flex;gap:30px}.card{flex:1}',wrap:x=>`<main>${x}<div class="cards"><div class="card"><p>卡片一</p></div><div class="card"><p>卡片二</p></div></div></main>`},
    {name:'04-Grid卡片',style:'.cards{display:grid;grid-template-columns:1fr 1fr;gap:30px}',wrap:x=>`<main>${x}<div class="cards"><div><p>卡片一</p></div><div><p>卡片二</p></div></div></main>`},
    {name:'05-绝对定位',style:'.item{position:absolute;top:250px;left:300px}',wrap:x=>`<main>${x}<p class="item">移动我</p></main>`},
    {name:'06-slide分页',wrap:x=>`<section class="slide active">${x}</section><section class="slide"><h1>第二页保持不变</h1><p>第二页文字</p></section>`,style:'.slide{display:none;width:1000px;height:600px;padding:40px}.slide.active{display:block}'},
    {name:'07-page分页',wrap:x=>`<div class="page">${x}</div><div class="page"><h1>第二页保持不变</h1></div>`,style:'.page{width:1100px;height:620px;padding:40px}'},
    {name:'08-section分页',wrap:x=>`<section>${x}</section><section><h1>第二页保持不变</h1></section>`,style:'body>section{height:600px;padding:40px}'},
    {name:'09-共享CSS',wrap:x=>`<main>${x}<h1 class="title">另一个标题保持不变</h1></main>`,style:'.title{color:#184f37}'},
    {name:'10-局部强调',wrap:x=>`<main>${x}<p id="rich">2026年 <strong>重要内容</strong> 与 <a href="https://example.com" onclick="return false">原有链接</a></p></main>`},
    {name:'11-本地图片',wrap:x=>`<main>${x}<img id="photo" src="assets/image.png" style="width:300px;height:160px;object-fit:cover"></main>`},
    {name:'12-背景图片',wrap:x=>`<main>${x}<div id="photo" class="photo" style="width:300px;height:160px;background-image:url('assets/image.png');background-size:cover"></div></main>`},
    {name:'13-外部样式',head:'<link rel="stylesheet" href="assets/external.css">',wrap:x=>`<main class="external">${x}<img src="assets/image.png" width="200"></main>`},
    {name:'14-简单表格',wrap:x=>`<main>${x}<table><tr><th>项目</th><th>数量</th></tr><tr><td>原型</td><td>12</td></tr></table></main>`},
    {name:'15-SVG保留',wrap:x=>`<main>${x}<svg width="300" height="100"><rect fill="#aecfba" width="300" height="100"/><text x="20" y="50">保留矢量图</text></svg></main>`},
    {name:'16-Canvas脚本保留',wrap:x=>`<main>${x}<canvas id="chart" width="300" height="100"></canvas></main><script>const ctx=document.getElementById('chart').getContext('2d');ctx.fillStyle='green';ctx.fillRect(0,0,100,100);</script>`},
    {name:'17-动画与渐变',style:'@keyframes fade{from{opacity:0}to{opacity:1}}h1{animation:fade 1s}.gradient{background:linear-gradient(30deg,#edf7e9,#ccc)}',wrap:x=>`<main class="gradient">${x}</main>`},
    {name:'18-中文与空格 路径',wrap:x=>`<main>${x}<p>中文、标点、emoji 🌿 与 English</p></main>`},
    {name:'19-长页面',style:'main{min-height:1400px}',wrap:x=>`<main>${x}<p style="margin-top:900px">页面末尾仍可滚动查看</p></main>`},
    {name:'20-原稿隔离',head:'<meta http-equiv="refresh" content="100;url=https://example.com">',wrap:x=>`<main>${x}<p onclick="window.__clicked=true">编辑时不执行事件</p><script>window.__originalScriptExecuted=true;document.body.dataset.scriptRan='yes';</script><iframe src="https://example.com"></iframe></main>`}
  ];
  return variants.map((v,index)=>{const file=path.join(root,v.name+'.html');const html=`<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>${v.name}</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,'Microsoft YaHei',sans-serif;color:#264a35;background:#f9faf2}main{padding:48px;min-height:600px}h1{font-size:42px}p{font-size:22px}table{border-collapse:collapse}td,th{padding:16px;border:1px solid #abc}${v.style||''}</style>${v.head||''}</head><body>${v.wrap(`<h1 class="title">原始标题 ${index+1}</h1><p>日期：2026年10月17日</p>`)}</body></html>`;fs.writeFileSync(file,html);return {file,name:v.name,html,index};});
}
module.exports={createFixtures};
