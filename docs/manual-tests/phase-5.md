# 手动测试清单 — Route A UI(Phase 5+6 验证)

> 配合 `node apps/vscode/scripts/smoke-shell.mjs`(自动化部分)+ 本清单(需 VS Code 交互)。
> 前置:3080 在线(dsh 0.1.0-rc.6);扩展宿主已启动(双击 `启动扩展.command`)。

## 1. 侧边栏渲染(核心)

- [ ] 活动栏点击 DeepSeek 图标 → 侧边栏直接显示 dsh 原生 UI(非白屏、无红色错误横幅)
- [ ] 布局为侧边栏形态:左侧工作区/会话区 + 中间会话区 + 细节栏折叠(窄屏不溢出)
- [ ] 背景与 VS Code 主题融合:深色主题下无白色大色块(html/body/frame 透明生效)
- [ ] 输入框、消息卡片的表面色正常(内容区不透明)

## 2. 会话与工作区

- [ ] 工作区列表含当前 VS Code 工作区(dsh-for-vs-code);选择工作区可用
- [ ] 会话列表显示历史会话(含标题/时间);新建会话用当前工作区
- [ ] 原生 Sessions 树(侧边栏树视图):切换会话 → webview 同步切换;重启后恢复上次会话
- [ ] fork 会话可用(需要会话至少一个已完成回合)

## 3. 聊天与工具

- [ ] 发送消息 → 流式输出正常;停止按钮可中断
- [ ] 工具调用卡显示(名称/参数/结果);mcp__ 前缀工具标注
- [ ] 审批弹窗:工具请求执行时出现"允许一次/拒绝";拒绝后工具不执行
- [ ] 模型/权限状态可见(状态栏或 UI 内);权限三档设置生效

## 4. 原生入口

- [ ] VS Code Chat 面板 `@DeepSeek Harness` participant 有响应(P0-2 复验)
- [ ] 编辑器右键"dsh: 解释选中代码"、Ask to fix 诊断、Code Actions 可用
- [ ] Ask 注入当前文件/选区/诊断上下文

## 5. 改动审查(changes 面板,自研,回归)

- [ ] agent 写盘 → 快照捕获 → `DeepSeek Harness: Review Changes` 显示 diff
- [ ] 一键回滚/接受正确更新 baseline

## 6. 连接管理

- [ ] 切换实例地址(`deepseekHarness.setBaseUrl`)→ 状态栏/UI 重连新地址(代理重定向,无需重载 webview)
- [ ] 3080 未启动时:状态栏"未连接" + tooltip 错误 + 重试按钮;webview 显示错误态而非白屏
- [ ] 实例 cwd ≠ 工作区时出现警告

## 7. 其他

- [ ] 终端面板输入命令,输出回传 UI
- [ ] 断线重连:mux 增量续接,事件不重复(seq 去重)
- [ ] 深色/浅色 VS Code 主题切换后 UI 可读

## 已知非问题(无需修复)

- mux 二进制帧被上游客户端丢弃(与浏览器版一致)
- `/plugins/events`(HMR dev SSE)404
- 设置/计划/交付物/工作流/agent-preset/权限预设/目录选择等插件不在 boot 图(由 VS Code 原生层接管)
