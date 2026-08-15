可以，而且从目前 DeepSeek 官方开源的 **DeepSeek Harness (`dsh`)** 架构来看，做成 VS Code 插件是比较自然的方向。关键不是“把 Web UI 搬进 VS Code”，而是：

> **保留 DeepSeek Harness 的 Agent Runtime / Cordis / Tool / Session / MCP 能力，把 `apps/web` 替换成 VS Code Extension + Webview / Chat API。**

官方架构本身已经把 **editor integration** 明确列为扩展点。([GitHub][1])

---

# 1. 先看 DeepSeek Harness 现在是什么结构

官方仓库目前大致是：

```text
deepseek-harness
│
├── apps/
│   ├── cli/
│   └── web/
│
├── packages/
│   ├── core/
│   │   ├── agent/
│   │   ├── agent-loop/
│   │   ├── session/
│   │   ├── tools/
│   │   ├── system-prompt/
│   │   └── ...
│   │
│   ├── llm/
│   ├── client/
│   │   ├── web/
│   │   ├── web-react/
│   │   ├── ui-primitives/
│   │   ├── ui-slots/
│   │   └── modules/
│   │
│   └── ...
│
├── vendor/
│   └── cordis/
│
└── native/
```

官方说明的核心设计是：

> **Everything is a Plugin**

也就是说，模型、工具注册、Session、Agent Loop、Filesystem、Sandbox、UI 都不是硬编码到某个“大核心”里的，而是通过 Cordis Plugin Tree 组合起来。([GitHub][1])

尤其重要的是官方已经明确写了：

```text
Add UI or editor integration
→ drive ctx.agents
→ render from session/event
```

所以 VS Code 本质上就是新增一个 **Editor/UI Adapter**。([GitHub][1])

---

# 2. 最推荐的 VS Code 架构

我建议不要：

```text
VS Code Extension
      │
      └── 直接重新实现 Agent
            ├── LLM
            ├── Tools
            ├── MCP
            ├── Session
            └── Agent Loop
```

这会把 Harness 的核心架构重新写一遍。

应该做成：

```text
                         VS Code
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Activity Bar                                        │
│      │                                               │
│      ▼                                               │
│  DeepSeek Harness Extension                          │
│      │                                               │
│      ├── Extension Host                              │
│      │      │                                        │
│      │      ├── Workspace / Files API                │
│      │      ├── Terminal API                         │
│      │      ├── Git API                              │
│      │      ├── LSP / Diagnostics                    │
│      │      └── VS Code Commands                     │
│      │                                               │
│      └── Webview                                     │
│             │                                        │
│             ├── Chat                                 │
│             ├── Tool Calls                           │
│             ├── Reasoning                            │
│             ├── Diff                                 │
│             ├── Sessions                             │
│             └── Agent Controls                       │
│                                                      │
└──────────────────────┬───────────────────────────────┘
                       │
                 IPC / Webview Message
                       │
                       ▼
            DeepSeek Harness Runtime
                       │
              ┌────────┴────────┐
              │                 │
          Cordis            Agent Loop
              │                 │
       ┌──────┼────────┐        │
       │      │        │        │
      LLM   Tools    Session   Events
       │      │        │        │
       ├──────┼────────┼────────┤
       │      │        │        │
    DeepSeek MCP     FS       Sandbox
```

这个架构最大的优点是：

**Harness 负责“Agent 是怎么工作的”，VS Code 负责“Agent 如何与 IDE 交互”。**

---

# 3. 哪些 DeepSeek Harness 可以直接复用

这部分其实非常多。

| DeepSeek Harness      | VS Code 插件 |
| --------------------- | ---------- |
| `core/agent`          | **直接复用**   |
| `core/agent-loop`     | **直接复用**   |
| `core/session`        | **直接复用**   |
| `core/tools`          | **直接复用**   |
| `llm/llm`             | **直接复用**   |
| MCP                   | **直接复用**   |
| Skills                | **直接复用**   |
| System Prompt         | **直接复用**   |
| Session persistence   | **直接复用**   |
| Tool lifecycle events | **直接复用**   |
| Web UI React          | **部分复用**   |
| Web CSS/UI primitives | **部分复用**   |
| Browser-specific boot | **不要复用**   |
| Browser server        | **不要复用**   |

官方 Web 前端现在本身就是：

```text
apps/web
    ↓
@deepseek-ai/dsh-client-web
    ↓
@deepseek-ai/dsh-client-web-react
    ↓
client modules / UI primitives
```

`apps/web` 的 package.json 已经表明它主要是 Vite + React 的 Web shell，而不是 Agent Runtime 本身。

所以你甚至不需要重写全部 Chat UI。

---

# 4. VS Code 里应该怎么承载 UI

这里有两条路线。

## 方案 A：Webview

最容易把现在的 DeepSeek Harness Web UI 搬进来。

```text
VS Code
│
└── WebviewPanel
       │
       └── React
            │
            └── DeepSeek Harness UI
```

优点：

* 可以直接复用 React UI
* 现在的 Web UI 改造成本最低
* Markdown
* Syntax Highlight
* Tool Call
* Reasoning
* Session Sidebar
* Diff Viewer

都容易实现。

缺点：

* VS Code 原生编辑器体验不是特别好
* Webview 和 Extension Host 之间要做 IPC
* 文件操作不能直接让 React 访问 Node API

---

# 5. 更好的方案：Webview + Extension Host

真正做成一个成熟插件，我更推荐：

```text
┌─────────────────────────────┐
│        VS Code UI           │
│                             │
│ ┌─────────┐ ┌─────────────┐ │
│ │ Sidebar │ │ Chat Panel  │ │
│ └─────────┘ └─────────────┘ │
│                  │          │
└──────────────────┼──────────┘
                   │
             Webview Message
                   │
                   ▼
┌──────────────────────────────────────┐
│          Extension Host              │
│                                      │
│  AgentController                     │
│       │                              │
│       ▼                              │
│  DeepSeek Harness Runtime            │
│       │                              │
│       ├── Agent                      │
│       ├── Session                    │
│       ├── Tools                      │
│       ├── MCP                        │
│       ├── LLM                        │
│       └── Cordis                     │
│                                      │
│  VS Code Adapters                    │
│       ├── Filesystem                 │
│       ├── Terminal                   │
│       ├── Git                        │
│       ├── Diagnostics               │
│       └── Editor                    │
└──────────────────────────────────────┘
```

这才比较接近 **Claude Code / Cline / Roo Code / Cursor Agent** 那种 IDE-native 架构。

---

# 6. 关键：不要让 Agent 自己“猜” VS Code 状态

例如用户：

> 修复这个 TypeScript error。

不要把整个 workspace 打包给 DeepSeek。

VS Code Extension Host 可以提供：

```ts
{
  file: "src/foo.ts",
  selection: {
    startLine: 42,
    endLine: 42
  },
  diagnostics: [
    {
      message: "Type 'string' is not assignable to type 'number'",
      line: 42
    }
  ]
}
```

然后通过 Harness：

```text
VS Code
   ↓
editor context
   ↓
agent.inject()
   ↓
DeepSeek Harness
   ↓
Agent Loop
   ↓
read_file
   ↓
edit_file
   ↓
LSP diagnostics
   ↓
Agent continues
```

而官方架构已经明确说明：

```text
agent.inject()
```

可以把 model-facing context 放进下一次 request。([GitHub][1])

---

# 7. VS Code 最值得做的几个 Tool

实际上你需要做的主要工作，就是把 VS Code 能力映射为 Harness Tools / Capabilities。

例如：

### `read_file`

```text
VS Code Workspace
       ↓
fs.readFile
       ↓
Harness Tool
```

### `write_file`

```text
Agent
  ↓
write_file
  ↓
WorkspaceEdit
  ↓
VS Code
```

### `apply_patch`

最好不要单纯：

```ts
fs.writeFile(...)
```

而是：

```text
Agent
 ↓
Patch
 ↓
VS Code WorkspaceEdit
 ↓
Editor
```

这样可以：

* 保持 Undo
* 保留 VS Code 文件状态
* 更容易显示 Diff
* 防止 Agent 直接破坏文件

---

# 8. Terminal 也应该走 VS Code

例如 Agent：

> npm test

不要让 Harness 自己随便：

```bash
child_process.exec("npm test")
```

而是做：

```text
Harness
   ↓
terminal.exec
   ↓
VS Code Terminal / subprocess
   ↓
stdout / stderr
   ↓
Harness
```

这样 Agent 的 terminal 和用户自己的 IDE environment 才是一致的。

不过有一个例外：

如果你希望 Harness 的 Sandbox 能力独立于 VS Code，那么可以保留 Harness 自己的 subprocess/sandbox provider。

官方架构已经把 shell、terminal、filesystem、sandbox 作为 capability seams，这非常适合做 VS Code adapter。([GitHub][1])

---

# 9. MCP 基本上不用重写

这是 Harness 很有价值的地方。

例如用户已经配置：

```json
{
  "mcpServers": {
    "github": {},
    "browser": {},
    "database": {}
  }
}
```

VS Code Extension 启动 Harness profile：

```text
VS Code
   ↓
DeepSeek Harness
   ↓
MCP
   ├── GitHub
   ├── Browser
   ├── Database
   └── Custom MCP
```

因此插件不是：

> 一个 DeepSeek Chat 插件

而是：

> **DeepSeek Harness Runtime 的 IDE frontend**

这个定位更准确。

---

# 10. Session 也是直接复用

官方 Harness 的 Session 是 append-only event log：

```text
SessionEvent
    │
    ├── user/message
    ├── assistant/chunk
    ├── assistant/message
    ├── tool/call
    ├── tool/result
    ├── step/start
    └── step/end
```

而且官方明确规定：

> model-visible 的信息必须能够从 session log 重建。

所以你的 VS Code UI 不应该自己维护另一份：

```ts
messages[]
```

然后和 Harness 再同步。

应该：

```text
Harness Session Event
        │
        ▼
VS Code Extension
        │
        ▼
Webview
        │
        ▼
UI rendering
```

这样：

* reload
* resume
* fork
* replay
* session history

都会自然工作。([GitHub][1])

---

# 11. 甚至可以直接利用现有 Web Client

这是目前特别值得注意的一点。

官方 `apps/web/package.json` 显示：

```text
@deepseek-ai/dsh-web-frontend
        │
        └── @deepseek-ai/dsh-client-web
                │
                ├── dsh-client-web-react
                ├── dsh-client-ui-primitives
                ├── dsh-client-ui-slots
                └── dsh-client-modules
```



而 `vite.config.ts` 又明确指出这些 client package 是为了浏览器 boot/runtime 而设计的。

所以可以设计成：

```text
packages/client/
       │
       ├── web/
       ├── web-react/
       ├── ui-primitives/
       ├── ui-slots/
       └── modules/
                │
                ├───────────────┐
                ▼               ▼
          Browser Web UI    VS Code Webview
```

这会比重新写一个 React UI 合理得多。

---

# 12. 我会怎样修改 Repository

比较干净的做法不是直接把 VS Code 插件塞进 `apps/web`。

建议：

```text
deepseek-harness/
│
├── apps/
│   ├── cli/
│   ├── web/
│   └── vscode/              ← 新增
│
├── packages/
│   ├── core/
│   ├── llm/
│   ├── client/
│   │   ├── web/
│   │   ├── web-react/
│   │   ├── vscode/          ← 可选
│   │   └── ...
│   │
│   ├── vscode-adapter/      ← 新增
│   └── ...
│
└── vendor/
    └── cordis/
```

更具体：

```text
apps/vscode/
│
├── package.json
├── tsconfig.json
├── esbuild.js / tsup
├── src/
│   ├── extension.ts
│   │
│   ├── agent/
│   │   ├── controller.ts
│   │   ├── runtime.ts
│   │   └── session-manager.ts
│   │
│   ├── vscode/
│   │   ├── workspace.ts
│   │   ├── terminal.ts
│   │   ├── editor.ts
│   │   ├── git.ts
│   │   └── diagnostics.ts
│   │
│   ├── webview/
│   │   ├── panel.ts
│   │   └── bridge.ts
│   │
│   └── commands/
│       ├── ask.ts
│       ├── agent.ts
│       └── review.ts
│
└── web/
    ├── App.tsx
    ├── components/
    └── ...
```

---

# 13. package.json 的核心贡献点

VS Code 插件至少需要：

```json
{
  "main": "./dist/extension.js",
  "activationEvents": [
    "onStartupFinished",
    "onView:deepseekHarness.chat"
  ],
  "contributes": {
    "commands": [
      {
        "command": "deepseekHarness.open",
        "title": "DeepSeek Harness: Open"
      },
      {
        "command": "deepseekHarness.ask",
        "title": "DeepSeek Harness: Ask"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "deepseekHarness",
          "title": "DeepSeek",
          "icon": "media/deepseek.svg"
        }
      ]
    },
    "views": {
      "deepseekHarness": [
        {
          "id": "deepseekHarness.chat",
          "name": "Chat"
        }
      ]
    }
  }
}
```

然后：

```text
Command Palette
        │
        ▼
deepseekHarness.open
        │
        ▼
AgentController
        │
        ▼
Harness
```

---

# 14. 我反而不建议第一版直接使用 VS Code Chat API

VS Code 有自己的 Chat Provider / Language Model API，可以把模型接入 VS Code Chat，但这条路线更适合：

> “把 DeepSeek 当成一个 Model Provider”

而不是：

> “把 DeepSeek Harness 做成一个 Agent 产品”。

因为 Harness 的优势并不只是 LLM：

```text
Agent Loop
Tool Calling
MCP
Skills
Sessions
Subagents
Sandbox
Filesystem
Approval
Goals
```

这些才是 Harness 的核心价值。

因此第一版更适合：

```text
Activity Bar
   ↓
DeepSeek Harness
   ↓
Webview Chat
```

而不是：

```text
VS Code Chat API
   ↓
DeepSeek model
```

后者可以作为第二阶段再支持。

---

# 15. 最终插件应该长什么样

比较理想的是：

```text
┌────────────── VS Code ───────────────────────────────┐
│                                                      │
│ Explorer   ┃                          ┌─────────────┐ │
│ Search     ┃                          │ DeepSeek    │ │
│ Git        ┃       Editor             │             │ │
│ DeepSeek   ┃                          │ Agent       │ │
│            ┃                          │             │ │
│            ┃                          │ ┌─────────┐ │ │
│            ┃                          │ │ User    │ │ │
│            ┃                          │ └─────────┘ │ │
│            ┃                          │             │ │
│            ┃                          │ Reading...  │ │
│            ┃                          │             │ │
│            ┃                          │ Tool Call   │ │
│            ┃                          │ ┌─────────┐ │ │
│            ┃                          │ │ npm test│ │ │
│            ┃                          │ └─────────┘ │ │
│            ┃                          │             │ │
│            ┃                          │ Diff        │ │
│            ┃                          │             │ │
│            ┃                          └─────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Agent 修改代码时：

```text
Agent
  ↓
edit_file
  ↓
VS Code WorkspaceEdit
  ↓
Git diff
  ↓
User Approve
  ↓
Apply
```

而不是直接覆盖文件。

---

# 16. 最重要的一个设计原则

**不要 fork DeepSeek Harness，然后大改 `core/agent-loop`。**

官方架构已经明确要求新功能尽量挂在 extension points：

```text
Add model provider
        → ctx.llm

Add tool
        → ctx.tools

Add shell
        → ctx.shell

Add filesystem
        → ctx.fs

Intercept agent
        → agent/*

Add UI/editor integration
        → ctx.agents + session/event
```

([GitHub][1])

因此 VS Code 版本应该是：

```text
DeepSeek Harness
       │
       ├── Web Profile
       │     └── Browser UI
       │
       ├── Headless Profile
       │     └── CLI / automation
       │
       └── VS Code Profile       ← 你新增
             ├── VS Code FS
             ├── VS Code Terminal
             ├── VS Code Editor
             ├── VS Code Diagnostics
             └── VS Code Webview
```

这和它现在的 **Profile / Bundle / Plugin** 设计是完全一致的。([GitHub][1])

---

# 17. 实际开发顺序

我会按这个顺序做，而不是一次把所有功能都搬过去：

### Phase 1：最小可用

```text
VS Code Extension
    ↓
Harness Runtime
    ↓
DeepSeek
    ↓
Chat Webview
```

只实现：

* Chat
* Streaming
* Session
* Read file
* Write file
* Diff
* Run command

### Phase 2：IDE-native

加入：

* 当前文件 context
* Selection context
* Diagnostics
* Workspace symbols
* Git diff
* Apply patch
* Terminal
* Approval

### Phase 3：Harness 全能力

加入：

* MCP
* Skills
* Subagents
* Background jobs
* Session fork
* Resume
* Sandbox
* Goals

### Phase 4：VS Code 原生能力

再考虑：

* `ChatParticipant`
* inline edit
* code actions
* CodeLens
* diagnostics action
* command palette
* editor context menu

---

# 18. 还有一个很重要的现成接口

官方目前已经提供：

```bash
dsh web
```

默认启动：

```text
http://127.0.0.1:3080
```

而官方其他 DeepSeek Agent 文档也明确提到，Harness/TUI 的 Runtime API 可以用于把 Agent Runtime 嵌入 IDE/Web UI。([GitHub][2])

所以你实际上有两个实现路线：

| 路线 | 做法                                     | 难度 |    推荐 |
| -- | -------------------------------------- | -: | ----: |
| A  | VS Code → HTTP → `dsh web` Runtime     |  低 |  ★★★★ |
| B  | VS Code Extension 直接嵌入 Harness Runtime | 中高 | ★★★★★ |
| C  | 重写 Harness Agent Loop                  | 极高 |     ★ |
| D  | 只接 DeepSeek API                        |  低 |    ★★ |

**想快速做出 MVP，先 A；想最终做成真正的 DeepSeek Harness VS Code，做 B。**

尤其现在官方已经明确把 Web 和 Runtime 分层，所以这条路线是可行的。([GitHub][1])

---

## 我建议你最终做成这个结构

```text
                DeepSeek Harness
                       │
           ┌───────────┴───────────┐
           │                       │
      Agent Runtime            Client Layer
           │                       │
     ┌─────┼─────┐          ┌──────┴──────┐
     │     │     │          │             │
    LLM   Tools Session     Web          VS Code
     │     │     │          │             │
     │     │     │       React UI       Webview
     │     │     │                         │
     │     │     │                    Extension Host
     │     │     │                         │
     │     │     │                    VS Code API
     │     │     │
     └─────┴─────┴─────────── Cordis ──────┘
```

**这比“把 Web UI 改造成 VS Code 插件”更准确：你是在给 DeepSeek Harness 增加一个 VS Code Client/Profile。**

另外，现在官方仓库是 **MIT License**，但明确处于 **Developer Preview**，并警告会出现 compatibility-breaking changes，所以现在直接基于官方仓库做插件是可行的，但最好把 VS Code adapter 与核心 Harness 解耦，不要大量修改上游 `packages/core`。([GitHub][2])

如果你准备实际开工，**下一步最值得做的是直接按官方 repo 当前 `master` 分支，把 `apps/vscode`、需要复用的 `packages/client/*`、以及 Extension Host ↔ Harness 的桥接层具体拆到文件级别**；这样可以直接开始写一个能 `F5` 跑起来的 VSIX，而不是停留在架构设计层面。

[1]: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md "deepseek-harness/docs/architecture.md at master · deepseek-ai/deepseek-harness · GitHub"
[2]: https://github.com/deepseek-ai/deepseek-harness "GitHub - deepseek-ai/deepseek-harness: DeepSeek Harness: Everything is a Plugin. · GitHub"
