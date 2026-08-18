# ARCH.md — dsh-for-vs-code 架构全图

> **用途**: coding agent 查阅本文件即可定位任意功能的代码位置，修改后按「维护规则」同步更新。
> **最后更新**: 2026-08-18 · 基于 dsh 0.1.0-rc.6 / vendor 47f94385(rc.5)

---

## 1. 系统定位

```
┌─────────────────────────────────────────────────────────────────────┐
│                     dsh-for-vs-code 系统边界                         │
│                                                                     │
│  ┌──────────────────┐       HTTP/WS        ┌─────────────────────┐  │
│  │  VS Code 插件     │ ◄══════════════════► │  dsh 实例 (3080)    │  │
│  │  (Extension Host) │   127.0.0.1 代理     │  Agent Runtime      │  │
│  │                   │                      │  Cordis / Tools     │  │
│  │  ┌─────────────┐ │                      │  Session / MCP      │  │
│  │  │  Webview     │ │   vscode-webview://  │  Skills / LLM       │  │
│  │  │  (UI Shell)  │◄├──────────────────────┤                     │  │
│  │  └─────────────┘ │                      └─────────────────────┘  │
│  └──────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────┘
```

**核心约束**: 本项目是 dsh web 实例的 **客户端**，不内嵌 runtime、不另起实例。
所有 agent loop / tool 执行 / LLM 调用均在 dsh 实例侧完成。

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4 · VS Code Integration (命令/设置/编辑器/终端/诊断)          │
│  src/commands/* · src/vscode/* · src/settings-bridge.ts            │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3 · Webview Shell (UI 渲染 + bridge 协议)                    │
│  src/webview/* · web/* · dsh-shell 构建产物                        │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2 · Agent Bridge (会话管理/状态机/RPC 信封)                   │
│  src/agent/* · src/rpc.ts                                          │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1 · Transport (HTTP/WS 连接/代理/帧编解码)                   │
│  src/agent/runtime.ts · src/agent/wire.ts · src/vscode/proxy.ts    │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 0 · Shared Utilities (dispose/logger/diff/patch/git-parse)   │
│  src/util/* · src/agent/git-parse.ts · src/agent/patch.ts          │
└─────────────────────────────────────────────────────────────────────┘
```

**依赖方向**: Layer 4 → 3 → 2 → 1 → 0（严格单向，禁止反向依赖）。
Layer 0-1 零 vscode 依赖，可在 node 下直接单测。

---

## 3. 模块目录地图

```
dsh-for-vs-code/
├── apps/vscode/                          # 主应用(唯一 workspace)
│   ├── src/
│   │   ├── extension.ts                  # ★ 入口:activate/deactivate,组装所有模块
│   │   │
│   │   ├── agent/                        # Layer 1-2: Agent Bridge
│   │   │   ├── runtime.ts                #   薄桥:HTTP/WS 传输,零状态缓存
│   │   │   ├── wire.ts                   #   协议模型:四象限 RPC + 帧 union
│   │   │   ├── session-manager.ts        #   会话列表 + append-only 事件缓冲
│   │   │   ├── controller.ts             #   状态机:idle/running/error/disconnected
│   │   │   ├── context.ts                #   模型上下文格式化(纯函数)
│   │   │   ├── git-parse.ts              #   git 输出解析(纯函数)
│   │   │   └── patch.ts                  #   unified diff 解析/应用(纯函数)
│   │   │
│   │   ├── webview/                      # Layer 3: Webview Shell
│   │   │   ├── chat-panel.ts             #   主 UI:侧边栏+编辑器面板(双模式)
│   │   │   ├── shell-html.ts             #   HTML 装配(纯函数)
│   │   │   ├── bridge.ts                 #   webview↔host 消息协议(类型化 union)
│   │   │   └── changes-panel.ts          #   改动审查面板(WebviewView)
│   │   │
│   │   ├── vscode/                       # Layer 4: VS Code Integration
│   │   │   ├── proxy.ts                  #   Origin 栅栏代理(HTTP+WS 转发)
│   │   │   ├── workspace.ts              #   文件快照监听 + diff + 回滚
│   │   │   ├── workspace-decoration.ts   #   编辑器内改动装饰(112GT)
│   │   │   ├── terminal.ts               #   Pseudoterminal 终端捕获
│   │   │   ├── git.ts                    #   仓库状态(只读 CLI 封装)
│   │   │   ├── editor.ts                 #   活动编辑器上下文收集
│   │   │   ├── diagnostics.ts            #   诊断收集 + 工作区统计
│   │   │   ├── diff-lines.ts             #   朴素行 diff(装饰用)
│   │   │   ├── context-attachments.ts    #   Phase 10 附着管理器
│   │   │   └── attachment-format.ts      #   附着格式化(纯函数)
│   │   │
│   │   ├── commands/                     # Layer 4: 命令注册
│   │   │   ├── context.ts                #   AppContext 类型 + ensureConnected/ensureSession
│   │   │   ├── ask.ts                    #   deepseekHarness.ask(选中文本→提问)
│   │   │   ├── agent.ts                  #   deepseekHarness.open(打开面板)
│   │   │   ├── review.ts                 #   deepseekHarness.review(改动审查)
│   │   │   ├── native.ts                 #   Code Actions + 右键菜单
│   │   │   ├── chat-participant.ts       #   VS Code ChatParticipant 注册
│   │   │   └── chat-stream.ts            #   Chat 流式增量消费
│   │   │
│   │   ├── sessions/
│   │   │   └── bootstrap.ts              #   会话启动(ensureFolderSession)
│   │   │
│   │   ├── settings-bridge.ts            #   VS Code 设置 ↔ dsh 设置双向同步
│   │   ├── rpc.ts                        #   RPC 信封公共模块(postRpc/listSessions/ensureWorkspace)
│   │   │
│   │   └── util/                         # Layer 0: 工具库
│   │       ├── dispose.ts                #   DisposableSet(disposer 组合)
│   │       ├── logger.ts                 #   分级日志(OutputChannel)
│   │       ├── nonce.ts                  #   CSP nonce 生成
│   │       └── diff.ts                   #   unified diff 文本生成
│   │
│   ├── web/                              # Webview 侧代码(esbuild 构建)
│   │   ├── SessionView.tsx               #   会话管理页(自建 React 视图)
│   │   ├── session-view-main.tsx         #   会话管理页入口(mount #dsh-sessions-root)
│   │   ├── ChangesApp.tsx                #   改动审查面板(React)
│   │   ├── changes-main.tsx              #   改动面板入口(mount #root)
│   │   └── dsh-attachment-ui.ts          #   Phase 10 附着 UI(注入上游对话输入区)
│   │
│   ├── scripts/
│   │   ├── build.mjs                     #   esbuild 打包(extension + webview)
│   │   ├── build-web-shell.mjs           #   ★ Route A 装配(vendor 源码 → dsh-shell)
│   │   ├── smoke-shell.mjs               #   冒烟测试(headless Chrome)
│   ├── probe.mjs                     #   3080 协议探测
│   ├── probe-phase3.mjs              #   Phase 3 协议面探测
│   └── ref-graph-rc6.json             #   裁剪图参考集
│   │
│   ├── dist/                             # 构建产物(不入 git)
│   │   ├── extension.js                  #   插件主 bundle(esbuild)
│   │   ├── web/
│   │   │   ├── changes.js                #   改动面板 bundle
│   │   │   ├── session-view.js           #   会话管理页 bundle
│   │   │   ├── dsh-attachment-ui.js      #   附着 UI bundle
│   │   │   └── dsh-shell/                #   ★ Route A 装配产物
│   │   │       ├── index.html            #     上游 shell HTML
│   │   │       ├── boot.js               #     插件注册清单
│   │   │       ├── bridge.js             #     webview↔host 桥
│   │   │       ├── shell.css             #     侧边栏融合样式
│   │   │       ├── session-view.js       #     会话管理页(拷贝)
│   │   │       ├── dsh-attachment-ui.js  #     附着 UI(拷贝)
│   │   │       ├── assets/               #     vite 构建产物
│   │   │       └── plugins/              #     client 插件 bundles
│   │   │
├── apps/vscode/test/                             # 测试文件
│   ├── smoke.test.ts                 #   冒烟测试
│   ├── wire.test.ts                  #   协议编解码测试
│   ├── bridge.test.ts                #   bridge 校验测试
│   ├── shell-html.test.ts            #   shell HTML 装配测试
│   ├── session-manager.test.ts       #   session 缓冲测试
│   ├── attachment-format.test.ts     #   附着格式化测试
│   ├── chat-stream.test.ts           #   chat 流式消费测试
│   ├── proxy.live.test.ts            #   代理集成测试(@live)
│   ├── runtime-live.test.ts          #   连 3080 集成测试(@live)
│   └── ...                           #   context/git-parse/patch/workspace/decoration 等
│   │
│   └── package.json                      #   插件清单(14 commands, 1 view(deepseekHarness))
│
├── vendor/deepseek-harness/              # 上游源码(submodule,不可修改)
│   ├── packages/                         #   上游 package 源码
│   ├── apps/web/                         #   上游 Web UI(vite 构建)
│   └── node_modules/                     #   上游依赖
│
├── dsh-file-attach/                      # 动态 Cordis 插件(附着系统)
│   ├── host.js                           #   Host half(pre-step waterfall 注入)
│   ├── client.js                         #   Client half(UI dock chips)
│   └── README.md                         #   插件文档
│
├── docs/                                 # 设计文档
│   ├── versions.md                       #   版本锁定记录
│   ├── http-bridge.md                    #   3080 协议探测结果
│   ├── gaps.md                           #   协议缺口清单
│   ├── refactor-requirements.md          #   重构需求
│   ├── release.md                        #   发布流程
│   ├── prompt-attach-vscode-files.md     #   附着需求规格
│   ├── handover-phase10-to-dsh-prompt.md#   Phase 10 交接
│   ├── probe-phase3-result.json          #   协议探测结果
│   ├── reviews/                          #   阶段 review 记录(phase-0~5,final)
│   └── manual-tests/                     #   手动测试 checklist
│       └── phase-1/2/3/5/9/10.md
│
├── AGENTS.md                             # AI 约束文档(红线/规范/pitfalls)
├── ARCH.md                               # ★ 本文件(架构全图)
├── TASK.md                               # 阶段计划与进度
├── package.json                          #   根 pnpm workspace 配置
└── pnpm-lock.yaml                        #   依赖锁定
```

---

## 4. 数据流

### 4.1 连接生命周期

```
Extension activate()
    │
    ├── HttpProxy.start()          ← 监听随机端口，转发到 3080
    │
    ├── ChatPanel 构造             ← 读 dsh-shell 产物，注入 CSP/变量
    │
    ├── HarnessRuntime 构造
    │   └── loop()                 ← 双 WS 连接 mux + host
    │       ├── host.describe      ← 握手:获取 version/cwd/model
    │       ├── pump(mux)          ← 帧分发:session/event, approval, ...
    │       └── pump(host)         ← 帧分发:session-added/removed, ...
    │
    ├── SessionManager 构造        ← 接收 mux 帧，维护事件缓冲
    │
    ├── AgentController 构造       ← 状态机:订阅 runtime 状态 + mux 帧
    │
    └── bootstrapFolder()          ← ensureFolderSession(当前工作区)
```

### 4.2 提问流程

```
用户输入(命令/webview/chat-participant)
    │
    ▼
extension.ts: handleRequest / askWithContext
    │
    ├── collectDiagnostics()       ← 当前文件诊断
    ├── gitChanges()               ← 工作区 git 摘要(条件)
    ├── attachmentManager          ← 附着文件内容(Phase 10)
    ├── composeFinalMessage()      ← 组装最终文本
    │
    ▼
AgentController.ask(sessionId, text)
    │
    ▼
HarnessRuntime.request('session.prompt', {sessionId, content})
    │
    ▼  HTTP POST /api/session.prompt
    │
dsh 实例(3080) 接收 → agent loop → LLM → 工具调用 → ...
    │
    ▼  WS /api/events.mux
    │
SessionManager.handleMuxFrame()
    │  session/event(seq=N)        ← append-only 缓冲
    │
    ▼
chatPanel.post({type:'event', events})
    │
    ▼  webview.postMessage()
    │
Webview(上游 React 组件) 渲染
```

### 4.3 Origin 栅栏绕行

```
┌──────────────┐  vscode-webview://   ┌──────────────┐  同源(改写)   ┌──────────────┐
│   Webview    │ ──── HTTP/WS ──────► │   HttpProxy  │ ──────────► │  dsh 实例    │
│  (不受信源)  │  127.0.0.1:随机端口  │  (扩展进程)  │  3080       │  (信任栅栏)  │
└──────────────┘                      └──────────────┘             └──────────────┘
                                           │
                                      改写 origin/host/sec-fetch-site
                                      为目标同源(3080 视角=同源请求)
```

### 4.4 Webview ↔ Extension Host 消息

```
┌──────────────────────────────────────────────────────────────┐
│                    bridge.ts 消息协议                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  WebviewRequest (webview → extension):                       │
│    ready | ask | stop | session:* | terminal:run |           │
│    changes:* | meta:* | goal:* | subagent:* |               │
│    dsh:new-session | dsh:locale-mismatch |                   │
│    dsh:attachments:* | switch-session:applied | debug        │
│                                                              │
│  ExtensionMessage (extension → webview):                     │
│    event | session:list | session:forked | state | error |   │
│    terminal:output | diagnostics | changes | meta:* |        │
│    dsh:switch-session | dsh:bootstrap-session |               │
│    dsh:attachments:state | dsh:attachments:error              │
│                                                              │
│  校验: validateWebviewRequest() 白名单结构校验                │
│  安全: 无 inline script(CSP nonce);无 dangerouslySetInnerHTML │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. 关键接口

### 5.1 Wire 协议 (wire.ts)

```
ClientRequest  → {type:'client-request', rpcId, method, payload}
ServerResponse → {type:'server-response', rpcId, result:{ok, value/error}}
ServerRequest  → {type:'server-request', rpcId, method, payload}  (WS 下行)

MuxFrame union:
  session/event | session/subscribed | session/queue | session/jobs |
  session/projection | approval/requested | approval/resolved |
  question/requested | question/resolved | stream/error

HostFrame union:
  host/session-added | host/session-removed | host/session-status |
  host/archived-sessions-changed | host/agent-error |
  host/workspace-changed | host/workspace-removed | stream/error
```

### 5.2 Runtime 状态机 (runtime.ts)

```
idle → connecting → connected ⇄ reconnecting → disconnected
                     │
                     └── disposed (终态)
```

### 5.3 Controller 状态机 (controller.ts)

```
idle ⇄ running → error
  └──── disconnected (runtime 断连时)
```

### 5.4 Bridge 消息类型 (bridge.ts)

```
WebviewRequest = ready | ask | stop | session:list | session:open | ...
ExtensionMessage = event | state | error | session:list | ...
AttachmentState = { activeFileEnabled, selectionEnabled, attachments, activeFile(fsPath/languageId/isDirty/isUntitled), selections, cordis(插件身份) }
```

---

## 6. 构建管线

### 6.1 Route A: vendor 源码 → dsh-shell

```
vendor/deepseek-harness/
    │
    ├── corepack pnpm install --ignore-scripts
    ├── build:lib:host        ← typert 契约
    ├── build:lib:client      ← client 类型
    └── build:web             ← apps/web vite 产物
          │
          ▼
build-web-shell.mjs (Route A 装配脚本)
    │
    ├── 扫描 dsh.client 声明 → client 包列表
    ├── 裁剪图断言(ref-graph-rc6.json)
    ├── 适配缝:resolveBase → __DSH_WEB_URL__
    ├── 拷贝 vite 产物 → dist/web/dsh-shell/
    ├── 拷贝 client bundles → plugins/<id>/client.js
    ├── 生成 boot.js(window.__DSH_BOOT__)
    ├── 生成 shell.css(侧边栏融合)
    ├── 注入 shell.html(CSP/变量)
    └── 拷贝 session-view.js + dsh-attachment-ui.js
          │
          ▼
dist/web/dsh-shell/ (webview 可加载)
```

### 6.2 Extension + Webview 打包

```
scripts/build.mjs (esbuild 双入口)
    │
    ├── 入口 1: src/extension.ts → dist/extension.js
    │   (VS Code 插件主 bundle，external vscode)
    │
    ├── 入口 2: web/changes-main.tsx → dist/web/changes.js
    │   (改动面板 React bundle，IIFE)
    │
    ├── 入口 3: web/session-view-main.tsx → dist/web/session-view.js
    │   (会话管理页 React bundle，IIFE)
    │
    └── 入口 4: web/dsh-attachment-ui.ts → dist/web/dsh-attachment-ui.js
        (附着 UI bundle，IIFE，无 React)
```

---

## 7. 文件→功能 速查表

| 功能需求 | 首选文件 | 说明 |
|---------|---------|------|
| 插件激活/停用 | `src/extension.ts` | activate/deactivate |
| HTTP/WS 连接 | `src/agent/runtime.ts` | HarnessRuntime |
| 协议帧类型 | `src/agent/wire.ts` | MuxFrame/HostFrame union + DynamicCordisInventoryRow |
| 会话管理 | `src/agent/session-manager.ts` | SessionManager |
| 状态机 | `src/agent/controller.ts` | AgentController |
| 模型上下文 | `src/agent/context.ts` | formatEditorContext |
| webview HTML | `src/webview/shell-html.ts` | assembleShellHtml |
| webview 消息 | `src/webview/bridge.ts` | WebviewRequest/ExtensionMessage |
| 侧边栏 UI | `src/webview/chat-panel.ts` | ChatPanel |
| 改动面板 | `src/webview/changes-panel.ts` | ChangesPanel |
| Origin 代理 | `src/vscode/proxy.ts` | HttpProxy |
| 文件快照/diff | `src/vscode/workspace.ts` | SnapshotWatcher |
| 编辑器装饰 | `src/vscode/workspace-decoration.ts` | WorkspaceChangeDecorationProvider |
| 终端执行 | `src/vscode/terminal.ts` | CapturingPty |
| git 查询 | `src/vscode/git.ts` | gitChanges (只读 CLI) |
| 编辑器上下文 | `src/vscode/editor.ts` | collectEditorContext |
| 诊断收集 | `src/vscode/diagnostics.ts` | collectDiagnostics |
| 附着管理 | `src/vscode/context-attachments.ts` | ContextAttachmentManager |
| 附着格式化 | `src/vscode/attachment-format.ts` | formatSendContext |
| 设置同步 | `src/settings-bridge.ts` | registerSettingsBridge |
| RPC 信封 | `src/rpc.ts` | postRpc/listSessions |
| 会话启动 | `src/sessions/bootstrap.ts` | ensureFolderSession |
| git 解析 | `src/agent/git-parse.ts` | parseStatusPorcelain |
| diff 解析 | `src/agent/patch.ts` | parsePatch/applyHunks |
| 会话管理页 | `web/SessionView.tsx` | SessionManagementView |
| 改动审查页 | `web/ChangesApp.tsx` | ChangesApp |
| 附着 UI | `web/dsh-attachment-ui.ts` | 注入上游对话输入区 |
| dsh-shell 装配 | `scripts/build-web-shell.mjs` | Route A 装配脚本 |
| 插件清单 | `apps/vscode/package.json` | 14 commands, 配置项 |
| 版本锁定 | `docs/versions.md` | 运行环境+依赖版本 |
| 协议探测 | `docs/http-bridge.md` | 3080 端点探测结果 |
| 协议缺口 | `docs/gaps.md` | 已知限制+降级策略 |
| 附着插件 | `dsh-file-attach/` | Cordis 动态插件(host+client) |

---

## 8. 维护规则(ARCH.md 本身)

1. **修改代码后必须同步更新本文件**:
   - 新增/删除模块 → 更新目录地图(§3)
   - 新增命令 → 更新速查表(§7)
   - 新增/修改消息类型 → 更新 bridge 协议(§4.4)
   - 新增 wire 帧类型 → 更新 wire union(§5.1)
   - 修改构建流程 → 更新构建管线(§6)
   - 修改状态机 → 更新状态图(§5.2/§5.3)

2. **更新时机**: 每次 PR 包含架构变更时，在同一个 commit 中更新 ARCH.md

3. **格式要求**:
   - ASCII 图用 ``` 围栏，保持等宽对齐
   - 目录地图用树形缩进，标注 ★ 的为核心入口文件
   - 速查表用 Markdown 表格，保持「功能需求→文件→说明」三列

4. **验证**: 新模块是否已加入目录地图和速查表;删除的模块是否已从两处移除

---

## 9. 与 AGENTS.md 的关系

- **AGENTS.md**: 红线、代码规范、pitfalls、协议约定 → **约束与规范**
- **ARCH.md**: 模块结构、数据流、接口、构建 → **代码导航与架构理解**
- coding agent 应**先读 ARCH.md 定位代码，再读 AGENTS.md 确认红线**，然后动手修改
- 修改后按本文件 §8 的维护规则同步更新 ARCH.md