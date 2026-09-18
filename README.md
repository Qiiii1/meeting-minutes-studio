# 会记 Minutes

**让每一次讨论，都有下文。**

一个可直接部署到 GitHub Pages 的会议纪要交互原型。原生 HTML、CSS、JavaScript，无构建步骤、无运行时依赖。

[在线体验](https://qiiii1.github.io/meeting-minutes-studio/) · [产品与接入方案](docs/PRODUCT.md)

![会记网页原型](assets/preview.png)

## 可以体验什么

- 会议列表、关键词搜索、待确认/已确认筛选。
- 完整的虚构示例流程，以及原文与纪要对照、来源定位。
- 粘贴真实文字创建手动草稿；录音选择、拖放和当前会话本地播放。
- 直接编辑标题、参与者、摘要、讨论要点、决策、下一步和待确认事项。
- 编辑后自动保存到 localStorage；修改已确认纪要会恢复待确认状态。
- 行动项新增、编辑、完成勾选和跨会议行动清单。
- 简洁商务 / 正式纪要两种排版预览，通过浏览器打印窗口另存 PDF。
- 单场会议 JSON 导出备份、会议删除、手机布局、键盘操作。

## 原型边界

**不调用讯飞或星火 API。** 示例生成是预设内容的演示动画；自定义文本创建手动编辑草稿，不会伪造 AI 生成结果。录音不会上传，不会转写，刷新后必须重新选择才能播放。

数据只存于当前浏览器，清理浏览器数据会删除记录。JSON 导出用于备份，当前没有导入恢复界面。PDF 使用浏览器“打印 / 另存为 PDF”，不是服务器直接生成文件。建议关闭浏览器打印页眉页脚，启用背景图形。

默认使用系统中文字体，无第三方字体、统计或分析请求。GitHub Pages 提供静态资源；未来生产版 API 密钥必须存于独立后端，不能放入此仓库或浏览器代码。

## 本地运行

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 `http://127.0.0.1:4173`。不建议直接双击 HTML，HTTP 环境中的本地存储与剪贴板行为更稳定。

## 部署到 GitHub Pages

1. Fork 仓库。
2. 打开 Settings → Pages。
3. Source 选择 **Deploy from a branch**。
4. Branch 选择 **main**，目录选择 **/(root)**，保存。
5. 等待 Pages 发布，访问 `https://你的用户名.github.io/meeting-minutes-studio/`。

站点使用相对资源路径，支持仓库子目录部署。`.nojekyll` 关闭 Jekyll 处理。

## 浏览器验证

需要 Node.js 和 Playwright。测试启动一个独立浏览器上下文，不修改用户浏览器中的会议。

```bash
npm install --no-save playwright
npx playwright install chromium
# 先在另一个终端启动上面的本地服务器
node tests/smoke.cjs
```

覆盖搜索筛选、来源定位、自动保存及刷新、确认状态、待办、PDF 排版、文字转义、音频选择、示例流程、手机溢出和 JavaScript 错误。测试截图和 PDF 写入 `/tmp`。实际转写与星火质量不在原型验证范围内。

## 文件结构

```text
index.html          页面框架与对话框
style.css           响应式布局和 PDF 打印样式
app.js              原型交互、示例数据和本地存储
assets/             图标和产品截图
README.md           运行与部署说明
docs/PRODUCT.md     产品范围与生产版接入计划
tests/smoke.cjs     浏览器流程验证
```

## 灵感与来源

纪要信息架构参考 [claude-office-skills / meeting-notes](https://github.com/claude-office-skills/skills/blob/main/meeting-notes/SKILL.md) 的摘要、决策与行动项组织方式；本项目未复制其源文件或完整提示词。改进规则：不明确的负责人和日期标记“待确认”，不默认归给组织者。

后续接口：[讯飞 LFASR](https://www.xfyun.cn/doc/asr/lfasr/API.html) · [讯飞星火 HTTP](https://www.xfyun.cn/doc/spark/X1http.html)。

## License

MIT © 2026 Qiiii1
