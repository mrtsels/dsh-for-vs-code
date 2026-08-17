# 整改需求清单 — 对照 liumin1128(infrastructure)与 112GT(native harness)

> 生成日期:2026-08-17。用途:全面整改当前代码的基准清单。
> 参考仓库:`references/deepseek-harness-for-vscode`(liumin1128,infrastructure)、`references/deepseek-harness-vscode`(112GT,native extension harness)。

## 一、需求表(用户全部细节需求,按域编号)

### R-A 架构与红线(AGENTS.md / TASK.md 固化)

| # | 需求 | 现状 |
|---|---|---|
| R-A1 | 扩展是 dsh 现有实例(127.0.0.1:3080)的**第二个 viewer**:不内嵌 runtime、不另起实例 | ✅ 已固化 |
| R-A2 | UI 用 **dsh 原生组件**(vendor 上游,不自研简化 UI) | ✅ boot 裁剪装配(25–26 插件) |
| R-A3 | **VS Code 原生兼容**:工作区=当前窗口工作目录、会话切换在原生层、模型/设置走 VS Code settings、底色用 VS Code 原生 | 🔶 部分(会话 tree/设置已原生,工作区关联/模型选择未完成) |
| R-A4 | 深色优先(拒白底) | 🔶 背景透明已做,组件色随 web 主题 |

### R-B 工作区与实例

| # | 需求 | 现状 |
|---|---|---|
| R-B1 | 工作区默认 = 当前 VS Code 窗口工作目录 | 🔶 ensureWorkspace + newSession 已做;缺"切换文件夹后自动重关联" |
| R-B2 | host.describe.cwd 与工作区不一致必须警告(P1-15) | ✅ 状态栏 + 一次性警告 |
| R-B3 | 新建会话 attach 到 VS Code 工作区对应 dsh workspace | ✅ newSession 用 workspaceId/cwd |
| R-B4 | 3080 未就绪时:状态可见(非白屏/无响应),给错误日志与重试 | ❌ 无(当前纯假设 3080 存在) |
| R-B5 | 复用已有实例,不杀用户进程 | ✅(纯 viewer 天然满足) |

### R-C 会话管理

| # | 需求 | 现状 |
|---|---|---|
| R-C1 | 会话列表 = VS Code 原生 tree(session.list) | ✅ Sessions tree(5s 刷新) |
| R-C2 | 点击会话切换(可靠重载,不丢 html) | ✅ boot 桥写 localStorage + 扩展重注入 html |
| R-C3 | 新建会话命令(当前工作区) | ✅ newSession(树标题栏 ➕) |
| R-C4 | 会话运行状态(running 旋转图标) | ✅ ThemeIcon sync~spin |
| R-C5 | 会话历史/恢复(重启后记住上次会话) | 🔶 globalState 有 lastActiveSession,webview 侧靠 localStorage |

### R-D 设置与模型

| # | 需求 | 现状 |
|---|---|---|
| R-D1 | VS Code settings 提供语言/主题选项,**默认 follow-web** | ✅ locale/theme,读写 3080 settings |
| R-D2 | 模型选择在 VS Code 原生层(QuickPick/状态栏) | ❌ 未做 |
| R-D3 | API key/credentials 不下发 webview、不进事件渲染 | ✅ 未下发 |
| R-D4 | 权限模式(只读/工作区写/全访问) | ❌ 未做(dsh 有 permission 命名空间) |

### R-E Chat 原生入口

| # | 需求 | 现状 |
|---|---|---|
| R-E1 | @DeepSeekHarness Chat Participant(name 小写) | ✅ 已改 deepseekharness(待验证) |
| R-E2 | 流式输出/取消/断连收尾 | ✅ askAndStream + token 取消 |
| R-E3 | 斜杠命令 + followup | ✅ /new + followupProvider |
| R-E4 | 注册失败必须可见 | ✅ showWarningMessage |

### R-F 侧边栏 Webview(渲染 dsh 原生 UI)

| # | 需求 | 现状 |
|---|---|---|
| R-F1 | 活动栏图标 → 侧边栏直显原生 UI(无节点中转) | ✅ WebviewViewProvider |
| R-F2 | webview 只渲染会话区+输入面(会话列表移出) | ✅ boot 裁剪 |
| R-F3 | 底色 = VS Code 原生(透明) | ✅ html/body transparent + boot 强制 |
| R-F4 | 白屏必须可诊断(错误横幅/探针) | ✅ 错误横幅 + 探针 |
| R-F5 | 工作区选择(ui-workspace 依赖)可用 | ✅ 恢复 ui-workspace 插件 |

### R-G 工具执行(原生 VS Code 能力)

| # | 需求 | 现状 |
|---|---|---|
| R-G1 | 文件写走 WorkspaceEdit / 快照 diff + 回滚 | ✅ ChangesPanel + SnapshotWatcher |
| R-G2 | terminal 走 VS Code Terminal API,禁裸 child_process | ✅ terminal.ts |
| R-G3 | 编辑器内改动可视化(diff 装饰) | ❌ 有 ChangesPanel 面板,无编辑器装饰 |

## 二、参考仓库技术细节对照

### 2.1 liumin1128(infrastructure)— 服务与状态基础设施

| 技术点 | 实现细节 | 对应我们 |
|---|---|---|
| **ServerManager 状态机** | `onState(listener)` 四态:`starting / ready / error / stopped`;错误带 `logTail`(40 行日志尾部) | 我们的 runtime 状态 `idle/running/error/disconnected`,**缺 logTail 展示** |
| **ensureReady(检测→复用/启动)** | 端口有服务则复用(不杀用户进程);无则 `spawn(dsh web --port <port>, {cwd: VS Code 文件夹})` | 我们是纯 viewer(假设已有);**缺"未就绪时的状态展示与一键启动"** |
| **restart(进程组回收)** | setsid 独立进程组,重启按组回收(Windows 例外:不脱离扩展宿主) | 我们不管理进程(合规) |
| **状态渲染跳过重复** | `render()` 中 **ready 态已 ready 时跳过重渲染**,避免 iframe 反复刷新 | 我们 switch-session 重注入 html 是必要路径;**普通状态更新应避免无谓重注入** |
| **工作区绑定** | `workspace()` = 当前 VS Code 文件夹;切文件夹后重启服务以新 cwd 启动 | 我们有 ensureWorkspace + 警告;**缺"切文件夹自动重关联"事件监听** |
| **dshPath 查找** | PATH 查找 → `npx --yes @deepseek-ai/dsh` 回退 | 我们不启动 dsh(不适用) |
| **配置项** | `port` / `dshCommand` / `startTimeoutSeconds`(默认 120s,首次启动装依赖) | 我们 `baseUrl`;**可加 startTimeout/自动启动开关(如果用户要一键启动)** |
| **CSP 只放行目标源** | `frame-src http://127.0.0.1:3080`(iframe 方案) | 我们用 html 注入(用户拒绝 iframe);CSP 原则一致:只放行必要源 |
| **宿主 UI 用 VS Code 变量** | `var(--vscode-editor-background)` / `--vscode-foreground` / `--vscode-button-background` / `--vscode-progressBar-background` | 我们 body 透明;**错误/加载态 UI 应统一用 VS Code 变量** |

### 2.2 112GT(native extension harness)— 原生能力

| 技术点 | 实现细节 | 对应我们 |
|---|---|---|
| **Runner 版本化协议** | `RUNNER_PROTOCOL_VERSION=1` + `RunnerHandshake{protocolVersion, harnessVersion, capabilities[]}`;能力枚举(sessions/streaming/cancellation/approvals/questions/fileProposals/terminals/languageServers/mcp/skills/subagents/workflows/…) | 我们无能力握手;**可加 capability 探测(host.describe 已有部分)** |
| **HostRunner 状态机保护** | `getStatus().state`;`running` 时**禁止切换模型/权限**,先 stop 当前 turn | 我们 controller 状态机有 running,但**模型/权限设置无此保护(且模型切换未做)** |
| **ProviderManager + secrets** | API key 存 `context.secrets`(`DEEPSEEK_API_KEY_SECRET`);环境变量注入 harness;模型选择/推理档位(setModel/setReasoningEffort) | 我们的模型在 dsh 侧;**设置同步可借鉴 secrets 模式** |
| **ChatView 快照+增量** | webview 消息:`snapshot`(全量状态:消息/todos/usage/changes/modelOptions/permission/status/apiKeyConfigured)+ `message/replaceMessage`(增量)+ `sessionHistory`(历史面板) | 我们 webview 是 dsh 原生 UI(不走快照模式);**模式可借鉴:我们的调试通道/状态推送可统一** |
| **会话历史 UI** | chat-view 内置 history 面板(新建/恢复/stop),`data-session-id` 点击恢复 | 我们有 Sessions tree(已原生,更优) |
| **工作区改动装饰器** | `createTextEditorDecorationType`:added/removed 用 `ThemeColor('diffEditor.insertedLineBackground')` 等;**编辑器内实时标记**改动行 + overviewRuler;点击 `vscode.diff` 打开归档对比 | 我们有 ChangesPanel(面板式);**编辑器装饰是 G3 缺失项,照此实现** |
| **权限三档** | `read-only / workspace-write / danger-full-access`;danger 需 modal 确认弹窗;running 时禁止切换 | **D4 缺失项;dsh 的 permission 命名空间可映射** |
| **写入前审查** | `PrewriteReviewService implements TextDocumentContentProvider`:工具写文件前 `requestDecision` → 打开 `vscode.diff` 预览 → allowed-once/rejected | 我们有快照 diff 回滚;**写入前审查可作增强(可选)** |
| **终端上下文** | `TerminalContextRecorder`:记录终端输出作为 prompt 附件(`kind:'terminal'`) | 未做(可选) |
| **内联补全** | `DeepSeekInlineCompletionProvider`(自研 LM 补全) | 不做(模型在 dsh 侧;用户未要求) |
| **能力热重载** | `CapabilitiesHotReloader`:harness 能力变化自动刷新 capability view | 可选 |
| **命令集** | openChat/configureApiKey/manageModelProviders/newSession/stopRunner/startRunner/prepareRunner/verifyConnection/selectHarnessFolder | 我们有 open/ask/review/setBaseUrl/newSession/switchSession/refreshSessions;**可加 verifyConnection** |

## 三、整改需求清单(按优先级)

### P0(先做,直接影响可用性)

| # | 整改项 | 参考 | 动作 |
|---|---|---|---|
| P0-1 | **3080 未就绪状态展示** | liumin1128 ServerManager | 连接失败时:状态栏显式"未连接"+ 错误详情(含 logTail 式信息)+ 重试按钮;webview 侧显示错误态而非白屏 |
| P0-2 | **验证 Chat Participant 响应**(name 小写修复) | 官方文档 | 用户 reload 验证;失败看警告窗内容 |
| P0-3 | **工作区切换重关联** | liumin1128 workspace() | 监听 `workspace.onDidChangeWorkspaceFolders`:切文件夹后重新 ensureWorkspace + 更新状态栏 cwd 对比 |

### P1(架构完整性)

| # | 整改项 | 参考 | 动作 |
|---|---|---|---|
| P1-1 | **编辑器内改动装饰**(G3) | 112GT WorkspaceChangeTracker | SnapshotWatcher 的 change 事件 → `createTextEditorDecorationType`(diffEditor 主题色)标记 added/removed 行 + overviewRuler;点击行 → 打开 diff |
| P1-2 | **权限模式三档**(D4) | 112GT permissionMode | VS Code 设置 `deepseekHarness.permissionMode`(read-only/workspace-write/danger-full-access)→ 同步 dsh 的 `permission` 命名空间;danger 需 modal 确认;running 时禁止切换 |
| P1-3 | **模型选择 QuickPick**(D2) | 112GT ProviderManager | 读 dsh settings(llm-deepseek 命名空间/settings.describe)列出可用模型 → QuickPick 选择 → mutate 写回 → 状态栏显示当前模型 |
| P1-4 | **连接状态机与错误可见统一** | liumin1128 onState | runtime 状态 + 错误信息(含网络路径)统一推送到状态栏/通知;失败不静默 |
| P1-5 | **切换会话持久化 lastActiveSession**(核查发现的不一致) | — | switchSession 命令补 `rememberActiveSession(context, sessionId)`,与 session:open 路径对齐 |

### P2(增强,按需)

| # | 整改项 | 参考 | 动作 |
|---|---|---|---|
| P2-1 | verifyConnection 命令 | 112GT 命令集 | 手动验证 3080 连接与 cwd 一致性,结果通知 |
| P2-2 | 能力握手/探测 | 112GT RunnerHandshake | host.describe 已有 version/cwd/provider/model;可扩展 capabilities 显示在状态栏 tooltip |
| P2-3 | 写入前审查(diff 预览批准) | 112GT PrewriteReview | 可选:文件写前 vscode.diff 预览 + allowed-once/rejected |
| P2-4 | 终端上下文附件 | 112GT TerminalContextRecorder | Chat 提问时附最近终端输出(kind:'terminal') |
| P2-5 | 状态栏点击打开面板 | liumin1128 状态栏 | 状态栏项 click → 聚焦侧边栏 |
| P2-6 | 设置同步扩展(推理档位等) | 112GT setReasoningEffort | settings.describe 的 llm 命名空间字段 → VS Code 设置映射 |

### 不做(架构红线,记录原因)

| # | 项 | 原因 |
|---|---|---|
| X-1 | iframe 内嵌 3080(liquin1128 方案本体) | 用户明确拒绝(R-F 用 html 注入原生组件);仅借鉴其 infrastructure(状态机/工作区/配置) |
| X-2 | 内嵌/启动 dsh 进程(liumin1128 serverManager 的 spawn 部分) | R-A1 红线:不另起实例;扩展是 viewer。仅保留"检测+提示" |
| X-3 | 自研 Chat UI/快照模式(112GT chat-view) | R-A2:UI 用 dsh 原生组件,不自研 |
| X-4 | 内联补全/自研模型调用(112GT inline-completion) | 模型在 dsh 侧,扩展不消费 VS Code 模型 |
| X-5 | API key 管理(112GT secrets) | 模型/凭据在 dsh 实例侧(3080),扩展不持有 |

## 五、整改执行状态(2026-08-17)

| 项 | 状态 | 说明 |
|---|---|---|
| P0-1 未就绪状态展示 | ✅ | 状态栏未连接态 + tooltip 错误 + 一次性通知 + 重试命令/状态栏点击 |
| P0-2 Chat 验证 | ⏳ 待用户验证 | name 小写已提交(8a61c1d),需 reload 确认 |
| P0-3 切文件夹重关联 | ✅ | onDidChangeWorkspaceFolders → ensureWorkspace + 树刷新 + cwd 重估 |
| P1-1 编辑器改动装饰 | ✅ | workspace-decoration.ts(diffEditor 主题色 + overviewRuler)+ diff-lines 单测 6 项 |
| P1-2 权限三档 | ✅ | permissionMode 设置 + 写回 permission.defaultPreset + danger modal + running 保护 |
| P1-3 模型 QuickPick | ✅(降级) | 只读展示当前模型/候选 + 指引 web UI 配置(模型属实例 provider 配置域,不直接改) |
| P1-4 连接状态统一可见 | ✅ | 与 P0-1 合并完成(lastError 传输层事实 + 通知) |
| P1-5 切换会话持久化 | ✅ | switchSession 补 rememberActiveSession + setActiveSession |
| P2-1 verifyConnection | ✅ | 命令输出 version/provider/model/cwd + 一致性提示 |
| P2-2 能力探测 | ✅ | 状态栏 tooltip:version/provider/model/cwd |
| P2-3 写入前审查 | ❌ 不适用 | 文件写在 dsh 实例侧(3080),扩展是 viewer 无法拦截;已有快照 diff+回滚替代 |
| P2-4 终端上下文附件 | ❌ 不适用 | dsh ask 协议无附件;扩展不注入 prompt(避免污染) |
| P2-5 状态栏点击 | ✅ | statusItem.command = retryConnection |
| P2-6 推理档位 | ❌ 不适用 | dsh settings 无 reasoningEffort 字段(agent-loop 仅 maxParallelToolCalls) |
| P2-7 AGENTS.md 例外条款 | ✅ | child_process 例外(只读 CLI 封装)已补 |

**G0:typecheck 0 / lint 0 / 54 tests / build 3 入口全绿。**

## 四、打勾项细节一致性核查(2026-08-17 实测)

对需求表中标 ✅/🔶 的项,逐一核查**实现细节与声称的一致性**(读代码 + 实测,非仅看"做了没有")。

### ✅ 核查通过(细节一致)

| 项 | 声称 | 核查证据 |
|---|---|---|
| R-A1 | viewer 不内嵌 runtime | 全 src/ 无裸 spawn/child_process 启动 dsh;terminal.ts 为 `createTerminal({pty})` + Pseudoterminal 标准捕获模式(注释声明),非绕过 |
| R-B2 | cwd 不一致警告 | `updateStatusItem`:mismatch → 状态栏 `$(warning) dsh: cwd ≠ 工作区` + tooltip 双值 + `cwdWarned` 一次性防刷 |
| R-C1 | 会话 tree 数据源 | `session.list` 实测返回 `{items:[{sessionId,updatedAt,running,blank,cwd,projections}]}`;tree 解析字段与之一致 |
| R-C2 | 切换链路与上游机制一致 | 上游 `attachPersistence`:localStorage **直接 JSON 存 state**(`setItem(name, JSON.stringify(state))`,非 zustand persist 包装),恢复 `JSON.parse(raw)` → `api.setState`;boot 桥写 `JSON.stringify({sessionId})` → 恢复后 `restored.sessionId` **字段一致** ✅ |
| R-C5 | lastActiveSession 有写路径 | `rememberActiveSession` 在 session:open/create/fork/ask 四处调用(extension.ts:199/205/214/306),globalState.update 真实执行 |
| R-D1 | follow-web 读写 3080 | `settings.mutate {ns, ops:[{op:'set',path:['preference']}]}` 实测 `ok:true` 且 describe 值变化;还原也实测 |
| R-E2 | 流式/取消/断连收尾 | `askAndStream`:轮询 100ms + 400ms flush + token 取消 → controller.stop + 断连时 flush 已累积文本并显式 markdown 告知 |
| R-G1 | 回滚/接受更新 baseline | `rollback` → `snapshots.set(path, change.before)`(workspace.ts:112);`accept` → `set(path, after)`(121)——不会把回滚记成新改动 |

### ⚠️ 不一致(需整改,已纳入清单)

| 项 | 声称 | 实际细节 | 不一致点 | 整改 |
|---|---|---|---|---|
| **R-C5** | "重启后恢复上次会话" | **原生 Sessions tree 的 `switchSession` 命令只 post 给 webview,不调用 `rememberActiveSession`** → globalState 仍是旧会话 | 切换会话后重启,恢复的是切换前的会话(webview 侧 localStorage 与扩展侧 globalState 不同步) | switchSession 命令内补 `rememberActiveSession(context, sessionId)`(新增 P1-5) |
| **R-A1** | "禁裸 child_process" | `src/vscode/git.ts:5` 用 `execFile`(只读 git 命令,注释声明用途) | 红线字面"禁裸 child_process"有受控例外未在 AGENTS.md 明示 | AGENTS.md 补充例外条款(只读 CLI 封装允许,agent 执行路径一律 Terminal API)(P2) |
| **R-A2** | "25–26 插件" | 恢复 ui-workspace 后实际 **26 个**(EXCLUDE 12 个) | 文档表述含糊 | 统一为"26 个"(EXCLUDE 12)(已改) |
| **R-A4** | "组件色随 web 主题" | webview 内 `theme.preference=system` 跟随 **Electron 系统主题**,与浏览器版(跟随浏览器/OS)存在环境差异 | 细节差异需明示 | 记录;如用户 OS 浅色+VS Code 深色,webview 组件色可能仍浅(P2 评估:webview 内强制 dark?) |

### 🔶 部分完成项的状态说明(非不一致,是未完成)

| 项 | 已完成 | 未完成 |
|---|---|---|
| R-A3 | 会话 tree 原生 / 设置原生 / 底色原生 | 模型选择(QuickPick)、权限模式 |
| R-B1 | ensureWorkspace + newSession 用工作区 | 切文件夹事件监听(workspace.onDidChangeWorkspaceFolders) |
| R-G3 | ChangesPanel 面板 | 编辑器内装饰器(112GT 模式) |
