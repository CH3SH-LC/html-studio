# 参与开发

HTML Studio 面向希望给 AI 演示稿改几个字、换一张图的普通人。新增功能应保持直接操作和简洁界面，保存时尽量保留未改动的原始源码。

## 环境与运行

使用 Windows x64、Node.js 22 或更新版本及 Microsoft Edge。持续集成使用 Node.js 24。普通使用者直接下载 Release，无需这些工具。

```powershell
git clone https://github.com/CH3SH-LC/html-studio.git
cd html-studio
npm ci
npm run setup
npm start
```

setup 从 Electron 官方下载固定的 43.1.0 并核验 SHA-256；也可通过 HTML_STUDIO_RUNTIME_ZIP 指定同版本的本地 ZIP。图标和内置示例已在源码中，正常构建不需要图形工具。scripts/prepare-assets.cjs 仅从锁定的 npm 依赖更新 reveal.js 示例资源。

## 完整验证与打包

完成一组相关实现后统一运行：

```powershell
npm run fetch:fixtures
npm run package
npm run test:all
node scripts/finalize.cjs
node scripts/archive.cjs
```

也可用 npm run release 顺序完成语料下载、运行时准备、构建、完整测试和归档。只运行单元测试时使用 npm test；它要求先下载语料。npm run test:real 单独执行四份外部成稿的桌面往返验收。

外部语料固定提交、字节数、SHA-256 与 Git blob SHA-1。下载脚本拒绝覆盖校验不一致的本地文件。原件和测试产物保留本机，不进入 Git 或便携包；请遵守各上游的许可证及素材权利说明。

测试会打开隔离配置的 Electron 窗口和无账户 Edge，不使用个人浏览器配置。JSON、逐页截图及保存副本写入 test-results/。CI 上传 JSON 报告，保留 14 天。文件对话框在自动化中使用测试替身，人工输入法及原生对话框仍需单独验收。

## 修改约定

- 修复兼容性时提供最小复现，或具有固定来源的公开 HTML。不要修改输入稿来让测试通过。
- 原稿文件保护、局部源码回写、撤销与保存重开应一并检查。
- 文稿在编辑时不得获得 Node.js 或桌面文件 API；播放与编辑器保持隔离。
- 本地环境、密钥、用户配置、私人文稿、运行日志不提交。运行 npm run check:public 检查已跟踪文件；新增公共文件时同步 scripts/public-files.cjs 的边界。
- 不承诺未经验证的 HTML 格式兼容性；在验收记录中说明自动化与人工证据。

请在 Issue 中描述操作、预期与实际结果；提交 PR 时说明修改原因和验证结果。项目源码采用 MIT，第三方组件保留各自许可证。
