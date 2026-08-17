# Phase 9 手动测试清单(UI/UX 定制)

> 前置:3080 在线、扩展已构建(启动扩展.command);对照项勾选后回填 TASK.md。
> 自动化已覆盖:headless E2E(布局/按钮/工作区页切换)+ vision 截图验证(对话/工作区/hero 三视图)。

## 1. 布局(仅对话面板)

- [ ] 侧边栏打开后只显示对话面板:无左侧图标 rail、无叠加的会话树
- [ ] 对话面板包含:session title(面包屑)、Chat/Trajectory 标签、对话内容、输入栏
      (模式控制/权限 chip/模型选择/Todo/Goal/附件)、子代理/后台任务按钮(header 右侧)
- [ ] 拖动 VS Code 侧边栏宽度,对话内容随宽度伸缩、无溢出错位

## 2. Workspaces 页(返回按钮)

- [ ] 对话模式左上角有 ‹ 返回按钮,与标题对齐、无遮挡
- [ ] 点击返回按钮 → 进入 Workspaces 页:原侧边栏内容(New Session + 工作区/会话列表)整页显示
- [ ] Workspaces 页点击会话行 → 打开该会话并自动返回对话模式
- [ ] Workspaces 页点顶部 New Session → 新建会话并返回
- [ ] 空会话(hero:"Choose a workspace")状态下返回按钮仍可用
- [ ] 重启扩展后停留在上次视图(chat/workspaces 记忆)

## 2b. 视觉细节(用户反馈迭代)

- [ ] "Deep diving..."(agent 忙碌状态行)为 VS Code 强调色(链接色),非品牌蓝
- [ ] 左上角返回按钮为"会话"气泡图标
- [ ] Workspaces 页为占满宽度的单栏列表(非窄条 sidebar),顶部保留 DeepSeek Harness logo
- [ ] Workspaces 页点会话标题 → 进入对应会话页(自动返回对话)

## 3. 主题同步

- [ ] 切换 VS Code 主题(如深色 ↔ 浅色),webview 配色跟随(背景/文字/卡片/边框)
- [ ] 背景无蓝色发光(hero 光斑应为中性灰)
- [ ] 编辑器面板方式打开(deepseekHarness.open)时底色为 editor 背景、侧边栏方式为 sideBar 背景

## 4. 首开体验

- [ ] 首次打开扩展(或新文件夹无会话):自动进入"以当前工作区为 workspace"的新会话
      (hero 上工作区 chip 显示当前文件夹名,输入即用)
- [ ] 已有会话时打开:恢复到上次会话(不强制新建)

## 5. 设置映射(设置 → 真实生效)

- [ ] Settings → Extensions → DeepSeek Harness:
- [ ] agentPreset 改 code/standard/minimal/cordis → 新建会话用对应 preset(输入栏/会话可感知)
      (也可用命令 "DeepSeek Harness: 选择 Agent Preset" 从名册选)
- [ ] permissionMode 改 read-only/workspace-write(运行中应被拒并提示;danger 需确认)
      → 新建会话权限生效(输入栏权限 chip 显示)
- [ ] locale 改 zh/en → webview 界面语言切换(webview 会重载一次生效;boot 后界面语言跟随)
- [ ] theme 改 light/dark/system → 写回实例 ui-theme.preference(浏览器 3080 设置页可见)
- [ ] busyEnter 改 steer/queue → 忙碌时回车行为变化(上游 ui-conversation.busyEnter)
- [ ] 反向同步:在浏览器 3080 设置页改以上任一项 → 回到 VS Code 数秒内 VS Code 设置自动更新

## 6. 回归(Phase 5/6 基线)

- [ ] 聊天流式、工具调用、审批、会话切换(Workspaces 页)、Review Changes 面板、ChatParticipant、终端
