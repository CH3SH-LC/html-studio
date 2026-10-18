# 外部 AI 演示稿验收语料

这四份 HTML 从作者公开仓库下载，未为适配 HTML Studio 修改输入。

- luoqianshi/Paper-Master @ a086271ff692bdaaecc6c35907624a0c3fb2b160
- sho-ai-magic/slide.md @ e22a68602ad42b80875bf93e7535145480ad6990

Paper-Master 的 Attention Is All You Need、Dialogue Director、DySample 是作者公开的个人论文汇报成稿；README Showcase 明确说明使用 AI Agent 协助完成。slide.md 的 Gemini Color System 是作者发布的 AI 生成预览稿，用于增加封装和组件布局覆盖，不将其当作真实会议使用证明。

来源声明：
- https://github.com/luoqianshi/Paper-Master#showcase--真实论文-ppt-演示
- https://github.com/sho-ai-magic/slide.md/blob/main/README.en.md （About sample.html）

provenance.json 固定提交、下载 URL、字节数、SHA-256、Git blob SHA-1。24 个原始文件均核对到上游 blob。各仓库 LICENSE 与 README 随下载输入保留。

原件与论文配图仅用作兼容性验收，不随源码仓库或应用便携包分发。先运行 npm run fetch:fixtures 下载固定原件，已存在的文件会核验；不一致时停止，不覆盖本地修改。Git 忽略下载目录与调查中间文件。

运行 npm run test:real；完整回归 npm run test:all 已包含它。逐页截图、修改后的副本、日志保存在 test-results/real-decks/<运行编号>/。三份论文稿引用上级目录 assets，首次打开按提示定位 paper-master 文件夹后即可读取。
