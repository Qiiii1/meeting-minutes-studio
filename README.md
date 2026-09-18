# 会记 Minutes

**让每一次讨论，都有下文。**

一个可直接部署到 GitHub Pages 的会议记录工具：一键开始会议，录制谈话并通过讯飞实时转写。原生 HTML、CSS、JavaScript，无构建步骤、无第三方运行时依赖。

[在线体验](https://qiiii1.github.io/meeting-minutes-studio/) · [产品与接入方案](docs/PRODUCT.md)

![会记网页原型](assets/preview.png)

## 可以体验什么

- **线下会议**：允许麦克风后自动录音，并实时显示讯飞返回的文字。
- **线上会议**：麦克风 + 用户共享的会议标签页/系统音频混合录制、转写；只保存声音。
- 录音计时、输入音量、暂停/继续、结束保存、回听和下载。
- 录音分片写入 IndexedDB，文字写入 localStorage，刷新后可恢复已保存内容。
- 讯飞连接验证、临时/最终字幕、断线提示、暂停关闭转写连接与继续时重连。
- 会议列表、关键词搜索、待确认/已确认筛选。
- 完整的虚构示例流程，以及原文与纪要对照、来源定位。
- 粘贴真实文字创建手动草稿；录音选择、拖放和当前会话本地播放。
- 直接编辑标题、参与者、摘要、讨论要点、决策、下一步和待确认事项。
- 编辑后自动保存到 localStorage；修改已确认纪要会恢复待确认状态。
- 行动项新增、编辑、完成勾选和跨会议行动清单。
- 简洁商务 / 正式纪要两种排版预览，通过浏览器打印窗口另存 PDF。
- 单场会议 JSON 导出备份、会议删除、手机布局、键盘操作。

## 如何开始会议

1. 点击右上角 **连接讯飞**，填写已开通「实时语音转写标准版」的 APPID 和 API Key。
2. 点击「验证并连接讯飞」，等待鉴权通过。凭据仅保存在此页面内存，刷新后需重新填写。
3. 点击「开始线下会议」并允许麦克风；或点击「开始线上会议」，选择会议标签页/屏幕并勾选共享音频，再允许麦克风。
4. 等待提示「讯飞已连接」后开始谈话。录音会同时保存在本地。
5. 点击「结束并保存会议」，回听、下载录音、核对文字，再编辑纪要或导出 PDF。

线上共享声音取决于操作系统和浏览器。优先使用桌面 Chrome 的会议标签页共享；没有音轨时会阻止开始，提示重新选择。无法保证任意桌面会议应用都能共享系统声音。建议戴耳机，避免扬声器的对方声音又被麦克风重复收录。

也可明确选择「暂用浏览器字幕」。这种模式依赖浏览器的 SpeechRecognition 服务及网络，不能保证可用；线上混合音轨识别仅在支持该接口的桌面 Chromium 中启用。识别失败不会伪造文字，本地录音仍继续。

## 当前边界与数据处理

- **讯飞实时转写已接入；星火自动纪要尚未接入。** 目前识别原文真实生成，摘要、决策和行动项需要人工编辑。示例纪要仍使用明确标识的虚构数据。
- 讯飞模式将实时音频直接通过 WSS 发往 `rtasr.xfyun.cn`，消耗用户自己的账号额度。API Key 不写入仓库、URL、日志、localStorage 或 sessionStorage；URL 只含短时签名。
- 浏览器模式可能将音频发送至浏览器识别服务商。网页没有其他第三方字体、统计或分析请求。
- 本地录音和文字保存在当前浏览器；清理网站数据会删除记录。请下载录音和 JSON 备份。JSON 尚无导入界面。
- 录音需要保持页面运行；锁屏、关闭标签页或系统休眠可能中断录制。恢复时只保证读取已保存分片。
- 导入已有音频是独立的本地播放入口，暂不支持文件批量转写；导入音频刷新后需要重新选择。
- PDF 使用浏览器「打印 / 另存为 PDF」，不是服务端导出。建议关闭浏览器默认页眉页脚，启用背景图形。
- 这是个人自带凭据的公开工具。若向多人提供统一账户、免填写密钥的服务，需要独立后端、鉴权和额度控制；不能把运营方 API Key 内置到公开网页。

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
node tests/live.cjs
node tests/xfyun.cjs
```

覆盖原有编辑/导出流程、真实 MediaRecorder（使用合成音源）、暂停续录、录音下载解码、IndexedDB 恢复、双声源混音、无共享音轨、权限拒绝、字幕异常、移动布局，以及讯飞签名和 16 kHz / 16 bit / 40 ms 音频分片。常规测试模拟识别服务，不产生云端费用。

`tests/provider-smoke.cjs` 是自愿运行的真实服务测试：通过环境变量 `XFYUN_APP_ID`、`XFYUN_API_KEY`、`TEST_AUDIO_FILE`（仅使用合成 WAV 测试语音）传入配置，会消耗少量讯飞额度。已用约 8 秒合成中文语音验证真实鉴权、浏览器音频发送、文字返回和保存；这不代表真实长会议准确率已验收。不要把凭据提交到 Git。

可用 `CHROME_PATH` 指定本机 Chrome 可执行文件，用 `BASE_URL` 指定测试站点。测试截图和 PDF 写入 `/tmp`。

## 文件结构

```text
index.html          页面框架与对话框
style.css           响应式布局和 PDF 打印样式
app.js              原型交互、示例数据和本地存储
live.js             线下/线上录音、字幕、IndexedDB 和会话管理
xfyun.js            内存凭据、讯飞 WSS 鉴权与结果解析
pcm-worklet.js      16 kHz 单声道 PCM 40 ms 音频分片
assets/             图标和产品截图
README.md           运行与部署说明
docs/PRODUCT.md     产品范围与生产版接入计划
tests/smoke.cjs     浏览器流程验证
tests/live.cjs      合成音源录制与异常验证
tests/xfyun.cjs     讯飞协议模拟验证
tests/provider-smoke.cjs  可选的真实讯飞服务测试
```

## 灵感与来源

纪要信息架构参考 [claude-office-skills / meeting-notes](https://github.com/claude-office-skills/skills/blob/main/meeting-notes/SKILL.md) 的摘要、决策与行动项组织方式；本项目未复制其源文件或完整提示词。改进规则：不明确的负责人和日期标记“待确认”，不默认归给组织者。

当前接口：[讯飞实时语音转写](https://www.xfyun.cn/doc/asr/rtasr/API.html)。后续：[讯飞 LFASR 文件转写](https://www.xfyun.cn/doc/asr/lfasr/API.html) · [讯飞星火 HTTP](https://www.xfyun.cn/doc/spark/X1http.html)。

## License

MIT © 2026 Qiiii1
