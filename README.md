# HTML Studio

**给 AI 做好的 HTML 演示稿，轻松改几个字、换一张图。**

A simple local desktop editor for small changes to AI-generated HTML presentations.

[下载 Windows 版](https://github.com/CH3SH-LC/html-studio/releases/latest) · [使用说明](使用说明.txt) · [验收与兼容范围](docs/08-真实AI成稿兼容性验收.md) · [参与开发](CONTRIBUTING.md)

![HTML Studio 编辑界面，显示内置示例](docs/screenshots/editor.png)

## 打开即用

1. 从 [Releases](https://github.com/CH3SH-LC/html-studio/releases) 下载 `HTML-Studio-0.3.1-win-x64.zip`。
2. 解压整个文件夹，双击 **HTML Studio.exe**。
3. 打开或拖入 HTML；单击选中，双击改字，选中图片后点击“换图”。
4. **Ctrl+S** 保存修改副本，**F5** 从当前页播放，**Esc** 返回编辑器。

无需安装 Node.js、启动服务或登录。移动应用时保留整个文件夹。首次可以体验内置示例。发布页同时提供 SHA-256 校验文件。

当前提供 **Windows x64 · 0.3.1** 便携应用。包含 Chromium，解压约 350 MiB；未做商业代码签名。macOS、Linux 暂无发行版。

## 可以做什么

- 直接修改文字、数字、字号、颜色、加粗、斜体和对齐。
- 替换本地图片，保留图片框，调整铺满、完整显示和可见位置。
- 拖动、方向键微调、图片等比缩放、文字框宽度和简单背景色。
- 页面缩略图、缩放、最近文件、素材定位、撤销和重做。
- 默认保留原稿，支持另存为、异常恢复、外部冲突和写入失败保护。
- 保存为普通 HTML 或原封装格式；必要的本地素材随另存文件复制，可独立播放。

应用通过局部源码修改保留未编辑的脚本、样式和结构。没有专用项目格式，也不需要模型 API。

## 支持范围

优先支持静态 HTML、明确的 slide/page/section 分页、基础 reveal.js 横向分页，以及包含静态页面模板的 `__bundler` / `deck-stage` 封装稿。

编辑时暂停原稿脚本，播放时在隔离窗口运行原脚本，不提供桌面文件 API。应用没有账户、遥测或云端上传；文稿自身的外部资源和脚本仍可能联网。网络素材不会自动下载。

复杂图表、SVG、Canvas 和视频保留原文，内部数据暂不编辑。任意 React/Vue 应用、纯脚本生成页面、iframe 拼页、嵌套分页、复杂变换和多层背景不保证可编辑。

## 已完成的验收

使用三份作者公开的 AI 论文汇报成稿和一份公开 AI 设计预览稿，共 **59 页**：Attention Is All You Need、Dialogue Director、DySample、Gemini Color System。四份均跑通打开、改字、换图、另存、重开、播放及独立 Edge 离线打开，**39/39 流程检查通过**。

另对封装稿通过 Windows 原生文件对话框和键盘补验。已有回归包括 17 项单元检查、40 项桌面功能检查、20 份布局往返与 2 项中文换行检查。人工中文输入法组词、全新电脑安装和所有显示缩放组合仍未验收。

完整来源、修复与证据边界见 [验收记录](docs/08-真实AI成稿兼容性验收.md)。这是四份稿件的兼容结果，不代表任意 AI HTML 均可无损编辑。

## 从源码运行

Windows x64，Node.js 22 或更新版本：

```powershell
git clone https://github.com/CH3SH-LC/html-studio.git
cd html-studio
npm ci
npm run setup
npm start
```

setup 下载并核验 Electron 43.1.0。开发与验收配置独立于日常应用配置。

```powershell
npm run fetch:fixtures
npm run package
npm run test:all
node scripts/finalize.cjs
node scripts/archive.cjs
```

完整构建需 Microsoft Edge 和网络；后续本地测试可复用已核验的语料与运行时。外部论文及素材不直接放进源码仓库，由 [固定来源清单](research/real-decks/provenance.json) 按需下载。测试产物写入 `test-results/`。更多说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

项目源码采用 [MIT](LICENSE)。[第三方组件](THIRD-PARTY-NOTICES.txt) 保留各自许可证。外部演示稿和论文配图不包含在应用便携包内。
