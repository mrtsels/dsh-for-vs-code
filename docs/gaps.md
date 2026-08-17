# 协议缺口清单(docs/gaps.md)

> 来源:Phase 3 协议面探测(2026-08-15,`scripts/probe-phase3.mjs` + follow-up 实测 dsh 0.1.0-rc.6 @ 3080)。
> 原则(TASK §4.1 P3-8):**不私自扩展 runtime**;探测失败的能力以"文档记录 + UI 降级"处理,并写明期望的上游接口。
> 原始数据:`docs/probe-phase3-result.json`(30 条 unary 逐条 + 全部帧样本)。
## Route A 源码构建实测发现(2026-08-17,P5-4/5 headless E2E)

- **rc.5 源码构建产物与 rc.6 npm 产物(3080 dist)字节级一致**(assets 哈希同名),协议漂移风险实测消除。
- **mux 通道存在二进制帧**,上游 rc.5/rc.6 客户端(connection readWebSocket)均丢弃
  (`typeof event.data !== 'string'` → drop);与浏览器版 3080 行为一致,非本扩展回归;
  UI 正常(会话/流式依赖的帧为文本帧)。若上游某日改发关键二进制帧,症状=事件缺失,排查入口在此。
- **`/plugins/events`(HMR dev SSE 通道)在无 dev server 时 404**:dsh-client-hmr 常驻图内,404 无害且
  与旧路线一致;Phase 6 裁剪时评估是否移除 hmr。
- **全量插件图(39)有 slot 双注册冲突**:`conversation.hero.workspace.directoryFlow`(ui-workspace ×
  ui-directory-picker-browse/native,priority 0)。上游浏览器同图同错(非致命,pageerror 级);

## Phase 9 UI/UX 定制实测发现(2026-08-18,headless E2E + vision 截图验证)

- **裁剪图 28→29(恢复 ui-plan)**:对话面板需要 Mode(计划)控制;Todo 面板属 ui-conversation
  自带(todoDockEntry),不依赖 ui-plan;其余裁剪不变。参考图 ref-graph-rc6.json 同步更新。
- **返回按钮不能插入 React 子树**:上游组件重渲染会清除外部注入的按钮(点击随即失效,用户实测)。
  改为 body 直接子元素的 fixed 悬浮按钮 + title 行 padding-left 让位;hero(空会话)场景同样适用。
- **Workspaces 页撑宽方案**:`#root width: max(1100px, 100vw)` 让 AppFrame 判定非窄布局
  (SIDEBAR_AUTO_COLLAPSE=1024)→ 侧边栏渲染宽版工作区浏览器;窄视口(<1100)中心列 0 宽
  (media query),宽视口(编辑器面板)正常双列 —— 两种场景均无错位。
- **heroGlow 硬编码 #6187D8**(SVG 属性,不读 token):去底色后透蓝光;CSS `fill` 覆盖为宿主
  前景色后中性化(保留 0.08 透明度)。FishLogo 走 currentColor,无此问题。
- **上游 ThemePresenter 把主题 token 写 body 内联变量**(压过样式表):shell.css 映射必须
  `!important` 且 light/dark 双写(`body, body[data-ds-dark-theme]`)。
- **permission 命名空间 schema 只有 defaultPreset 可写**;`preference` 是运行态镜像字段
  (settings.describe 里 value 同时含两者,但 schema dict 仅 defaultPreset)——旧实现写
  preference 实际无效,Phase 9 修正为写 defaultPreset。
- **会话历史中的错误卡片是数据不是故障**:上游正确渲染会话内错误消息(如 tool 调用失败),
  smoke 白屏检测改用 rootChildren + pageerror。
  Phase 6 裁剪排除 directory-picker-* 后消失。


## 实测端点可用性一览

| 能力 | 端点/帧 | 实测 | 本扩展实现 |
| --- | --- | --- | --- |
| 会话 CRUD/历史/fork | session.list/create/history/fork/prompt/cancel/rename | ✅ 200 | ✅ 已用 |
| Skills 目录 | skill.list {sessionId} | ✅ 200(ego-browser,modelInvocable=true) | ✅ 洞察面板"技能"tab |