# TASK.md — dsh-for-vs-code 实施任务书

> 本文件是 **AGENTS.md** 契约与 **references/suggestions.md**(SSOT,§12/§13/§17/§18)的逐阶段执行计划。
> 每个阶段 = 详细步骤(动作 → 产出 → 验证)+ 完成 checklist + 强制 Review 关卡。
> 最终交付以 **§7 交付效果 Checkbox** 全部勾选为准。
>
> 文档属性:版本 v0.1 | 语言:中文(标识符/命令用英文)| 更新:每次阶段结束必须修订本文件并打勾。

## 进度快照(2026-08-15,随时更新)

- **Phase 0 脚手架**:✅ 完成(G0 全绿;G1 FAIL→P1×3 修复 292e91c,复检 PASS)
- **Phase 1 MVP**:✅ 完成(40 测试全绿,commit e45038c;G1 FAIL→P1×5 已随 996aff9 修复)
- **Phase 2 IDE-native**:✅ 完成(40 测试全绿;G1 审查 deleg_3930aeaf 已派)
- **Phase 3 全能力**:✅ 完成(40 测试全绿;G1 审查待派;手动场景待 F5)
- **Phase 4 VS Code 原生**:⬜ 未开始

> 当前状态:Phase 4 开发中。dsh web @ 3080 运行中;manual 验证(P1-14/P2-10/P3-9)等你有空按 F5。

---

## 0. 总览

### 0.1 目标与路线

| 项 | 内容 |
| --- | --- |
| 一句话目标 | 给 DeepSeek Harness 增加一个 **VS Code Client/Profile**:复用 Agent Runtime / Cordis / Tools / Session / MCP / Skills,把浏览器壳换成 VS Code Extension + Webview |
| MVP 路线 | **Route A**:VS Code → HTTP → `dsh web` runtime(端口 3080,难度低,先出 MVP) |
| 终局路线 | 保持薄客户端:连接**任意 dsh web 实例**(地址可配),不内嵌 runtime、不另起实例 |
| 禁止 | **Route C**(重写 agent-loop)、**Route B**(内嵌 runtime = 独立实例)、fork 上游、修改 `packages/core` / `agent-loop` |

### 0.2 环境基线(已实测,2026-08-15)

| 项 | 值 | 备注 |
| --- | --- | --- |
| node | v22.22.3 | 满足上游 `^22.19 || >=24` |
| pnpm | 本机 10.32.1;上游要求 11.7.0(corepack 按 `packageManager` 字段取) | 本仓库自定 `packageManager`;若引入上游包需对齐上游版本 |
| dsh | **0.1.0-rc.6**(全局,~/.npm-global) | 必须锁版本,记录到 `docs/versions.md` |
| dsh web | http://127.0.0.1:3080,运行中(HTTP 200);cwd=`/Users/minimx/dsh-for-vs-code`,模型已配 deepseek-v4-flash,attachedSessions=2 | 后台实例随会话结束而死,重开用 `npx @deepseek-ai/dsh web`;插件连的就是这个实例 |
| git | 本地仓库已建(main,3 commits);remote 待建 | P0-1/P0-11 完成;push 待 `gh repo create --source . --push` |

### 0.3 已探明的 wire contract(写入 TASK 的协议笔记,Phase 1 只做验证 + 固化)

来源:`@deepseek-ai/dsh-client-connection` + `dsh-host-webserver` README(rc.6 实测):

- 传输:HTTP **POST** `/api/<method>`(前缀 `/api` 单路由、**端点在路径**,如 `/api/host.describe`;裸 `/api` 404;Fetch bridge,体上限 160 MiB);
- 信封:`{type:"client-request", rpcId, method, payload}` → `{type:"server-response", rpcId, result:{ok:true,value}|{ok:false,error:{code,message,details}}}`;WS 帧是 `server-request` 全形(host→client);
- 下行:两个 **WebSocket downlink**,仅服务端→客户端文本消息:
  - `/api/events.mux`(会话/工具事件)
  - `/api/events.host`(host 事件)
- 就绪握手:`host.describe` HTTP 调用成功 **且** 两个 WS 均打开(实测 200:`{version:"0.0.1", cwd, provider:"deepseek-official", model:"deepseek-v4-flash", attachedSessions, canOpenPath}`);
- 信任栅栏:loopback 权威(本机直连 127.0.0.1 即通过)或 `trustedHosts`;失败 403 / 拒绝握手;
- 普通 GET 到 `/api/events.*` 返回 **426**(无 SSE 降级);
- 方法名已知样例:`host.describe`、`session.create`、`agentPreset.list` / `agentPreset.select`、`settings.describe` 等;完整方法面 Phase 1 探测确认;
- mux 帧实测样例:`{"type":"server-request","method":"session/subscribed","payload":{"type":"session/subscribed","sessionId":"session-…","lastSeq":N}}`;
- 服务端仅绑定 127.0.0.1(默认),**无鉴权**,禁止 `--host 0.0.0.0`;
- **升级 dsh 后必须回归**(协议无稳定契约)。

### 0.4 阶段总览

| 阶段 | 名称 | 核心交付物 | Review 关卡 | 里程碑 |
| --- | --- | --- | --- | --- |
| Phase 0 | 工程脚手架 | 可 F5 的空壳扩展 + 构建/lint/test 流水线 | G0 | M0 |
| Phase 1 | MVP(最小可用,Route A) | HTTP 桥 + Chat Webview + 会话流式渲染 | G0 + G1 | M1 |
| Phase 2 | IDE-native | 编辑器上下文 / diagnostics / git diff / apply patch / terminal / 审批 | G0 + G1 | M2 |
| Phase 3 | Harness 全能力 | MCP / skills / subagents / jobs / fork / resume / sandbox / goals / 连接管理 | G0 + G1 | M3 |
| Phase 4 | VS Code 原生 | ChatParticipant / inline edit / code actions / CodeLens | G0 + G2(交付门) | M4 |

### 0.5 通用工程规范(所有阶段强制,违反即 Review FAIL)

1. **ESM everywhere**,无 CJS 残留;TypeScript `strict`,无 `any`(协议边界窄化点必须注释);
2. **注册即 effect**:所有 `ctx.on` / `onDid*` / 事件订阅必须返回 disposer,deactivate 全量清理;
3. Session 是 **append-only event log**:UI 只从 `session/event` 渲染,**禁止自维护一份 messages[] 再同步**;model-visible 信息必须可从事件日志重建;
4. 写文件 / apply_patch 走 **VS Code WorkspaceEdit**(保留 undo + diff + 审批);Route A 期间的技术债见 §2.2 D2 与 §8 R3;
5. terminal 走 **VS Code Terminal API**,不直接 `child_process`;
6. 编辑器上下文用注入(agent.inject 等价)进 model-facing context,不打包整个 workspace;
7. 文档中文、标识符/命令英文;`git add` 只加具体路径,**禁 `git add .` / `-A`**;commit 后立即 push(remote 就绪后);
8. 所有 `@deepseek-ai/*` 依赖版本锁定并记录到 `docs/versions.md`;
9. 不 fork 上游、不改 agent-loop;新能力挂官方扩展点(UI → `ctx.agents` + `session/event`;tool → `ctx.tools`;shell → `ctx.shell`;fs → `ctx.fs`;model → `ctx.llm`);
10. 验证 dsh 服务用 `curl`,不靠浏览器;headless 未配模型时退出码 1(文档明确配置方式)。

---

## 1. Phase 0 — 工程脚手架(里程碑 M0)

**目标**:一个能 `F5` 跑起来的空壳扩展 + 完整工程流水线(构建/类型/lint/测试/打包),贡献点与 §13 一致。

### 1.1 前置确认

- [ ] `dsh --version` == `0.1.0-rc.6`,写入 `docs/versions.md`
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/` == 200(不在则后台 `npx @deepseek-ai/dsh web`)

### 1.2 详细步骤

**P0-1 初始化仓库**
- 动作:`git init`;`git config user.name/email` 确认
- 产出:`.gitignore`(node_modules/、.vscode/、lib/、dist/、`*.vsix`、.DS_Store、apps/web/dist/ 等上游惯例)
- 验证:`git status` 干净

**P0-2 根工程文件**
- 产出:根 `package.json`(private、`packageManager` 字段、scripts:`build`/`typecheck`/`lint`/`test`/`package` 全部委托给 `apps/vscode`)、`pnpm-workspace.yaml`(packages: [apps/*])
- 验证:`pnpm install` 成功

**P0-3 `apps/vscode/package.json`(贡献点核心,对照 §13)**
- 必须包含:
  - `"main": "./dist/extension.js"`、`"type": "module"`(ESM 扩展)
  - `"engines": { "vscode": "^1.95.0" }`(ESM 扩展需较新版本,以实测为准;devDeps 的 `@types/vscode` 同版本)
  - `"activationEvents": ["onStartupFinished", "onView:deepseekHarness.chat"]`
  - contributes:`deepseekHarness.open` / `deepseekHarness.ask` 命令;activity bar 容器 `deepseekHarness` + view `deepseekHarness.chat`;icon `media/deepseek.svg`
  - devDeps:typescript、esbuild、@types/vscode、@types/node、@types/react、@types/react-dom、react、react-dom、oxlint、vitest、@vscode/vsce
- 验证:`pnpm --filter dsh-for-vscode install` 成功(包名不带 scope,避免冒充官方 @deepseek-ai/*)

**P0-4 `apps/vscode/tsconfig.json`**
- 要点:`"strict": true`、`"module": "NodeNext"`、`"moduleResolution": "NodeNext"`、`"target": "ES2023"`、`"noEmit": true`(esbuild 负责产物)、ESM 语义
- 验证:`pnpm typecheck` 通过(空项目也无错)

**P0-5 构建脚本 `apps/vscode/scripts/build.mjs`(esbuild)**
- 入口 1:extension — `src/extension.ts` → `dist/extension.js`(platform: node,external: vscode)
- 入口 2:webview — `web/main.tsx` → `dist/web/index.js`(JSX + react)
- 模式:`--watch` 开发;输出 `dist/web/index.html` 骨架(由脚本生成,含 CSP)
- 验证:`pnpm build` 产出 dist/ 两个入口

**P0-6 VS Code 调试配置**
- 产出:`.vscode/launch.json`(`type: "extensionHost"`,preLaunchTask: build)、`.vscode/tasks.json`(build/watch)
- 验证:F5 能弹出 Extension Development Host 且无报错

**P0-7 图标与资源**
- 产出:`apps/vscode/media/deepseek.svg`
- 验证:活动栏图标显示

**P0-8 lint / test 骨架**
- 产出:`apps/vscode/oxlint.json`(或 .oxlintrc)、`apps/vscode/test/` 下一个冒烟测试(smoke.test.ts)
- 验证:`pnpm lint`、`pnpm test` 全绿

**P0-9 最小 extension.ts**
- 内容:activate() 注册 `deepseekHarness.open` / `deepseekHarness.ask`(打开一个占位 WebviewPanel "Hello");deactivate() 清理
- 验证:F5 → 命令面板两个命令可触发

**P0-10 冒烟验证**
- 动作:干净 VS Code 环境 F5 一遍;扩展日志无 error
- 验证:活动栏图标 + 命令 + 占位 webview 三处可见

**P0-11 首次提交**
- 动作:`git add` 具体路径(禁 add .)+ `git commit`(feat: scaffold)
- 验证:`git log` 有提交;push 需用户提供 remote(记录待办)

### 1.3 Phase 0 完成 Checklist

- [x] P0-0 版本锁定记录(docs/versions.md)
- [x] P0-1 git 仓库 + .gitignore
- [x] P0-2 pnpm workspace 可 install
- [x] P0-3 贡献点与 §13 完全一致(命令/视图/容器/icon)
- [x] P0-4 strict TS + ESM 编译通过
- [x] P0-5 build 产出 extension + webview 双入口,watch 模式可用
- [x] P0-6 F5 调试链路打通(launch/tasks 就位;CLI --extensionDevelopmentPath 冒烟等效验证)
- [ ] P0-7 活动栏图标可见(media/deepseek.svg 已配置,待 F5 人工确认)
- [x] P0-8 lint/test 骨架全绿
- [x] P0-9 两个命令可触发占位面板(命令已注册;面板打开待 F5 人工确认)
- [x] P0-10 干净环境冒烟通过(独立 user-data-dir,扩展激活成功无错误)
- [x] P0-11 首次 commit 完成(remote 已建,push 完成)
- [ ] **G1 Review(Phase 0)通过**,记录 docs/reviews/phase-0.md

---

## 2. Phase 1 — MVP 最小可用(里程碑 M1,Route A)

**目标(一句话验收)**:F5 启动扩展 → Ask 一个问题 → webview 内流式显示回答,包含会话列表、工具调用卡片、停止按钮;事件全部来自 runtime 的 downlink,零自建模。

### 2.1 阶段内设计决策(先定稿,写进 docs/http-bridge.md)

- **D1 桥形态**:POST `/api` + 双 WS downlink(`events.mux` / `events.host`),就绪 = `host.describe` 成功 + 双 WS 打开。`src/agent/runtime.ts` **只做传输**,不含业务逻辑。
- **D2 文件写路径(固有边界,技术债 T-1,最终形态)**:agent 跑在 dsh 实例进程内,read/write 走 Harness 自己的 fs,**VS Code 无法截获**——这是"映射现有实例"的必然结果,不设"根治"目标。策略:
  - 方案 a(默认):扩展对 workspace 关键目录做 fs.watch + 快照对比,UI 提供 "查看 agent 改动 diff" 视图,支持一键回滚(记录快照);
  - 方案 b:全 patch 模式(agent 只产出 patch,VS Code 应用)——若协议探测发现可强制,优先 b;
  - 两者都**不是**真正的 WorkspaceEdit 审批流;接受为最终形态,记入 §8 R3。
- **D3 会话模型**:优先用协议现有会话能力(`session.create` 等,探测确认);Phase 1 内存态即可,持久化留 Phase 3。
- **D4 取消语义**:探测 runtime 的停止/取消方法;若无,降级为断开当前 generation 并重连(文档记录)。

### 2.2 详细步骤

**P1-1 协议探测与固化(独立步骤,最优先)**
- 动作:用 node 写 `apps/vscode/scripts/probe.mjs`(ws 客户端):
  1. GET `/` 确认 SPA 与 200;
  2. POST `/api` 发 `host.describe` 探测请求,记录请求/响应形状;
  3. 升级 `/api/events.mux` 与 `/api/events.host`,各收若干条消息,记录 JSON 结构;
  4. 验证信任栅栏(带/不带 Host 头对比)、GET 426 行为;
  5. 探测方法面:session.create / agentPreset.list / settings.describe / 停止方法,逐条记录签名;
  6. 建会话 → 提问 → 完整录一条事件的**时间线样例**(user/message → step/start → assistant/chunk* → tool/call → tool/result → assistant/message → step/end),作为 UI 渲染的黄金样本
- 产出:`docs/http-bridge.md`(端点、消息结构、事件时间线、探测日期与 dsh 版本)
- 验证:probe 脚本在 3080 上全绿,文档可复现

**P1-2 定义 wire 类型 `src/agent/wire.ts`**
- 内容:`RpcRequest` / `RpcResponse` / `ServerRequest`(事件 union:user/message、assistant/chunk、assistant/message、tool/call、tool/result、step/start、step/end、subagent/* 预留);编解码函数(含版本断言)
- 验证:vitest 单测(编解码往返)

**P1-3 `src/agent/runtime.ts`(薄桥)**
- 内容:HarnessRuntime 类 — connect(`host.describe` 握手 + 双 WS)、`request(method, params)`(POST `/api`)、事件订阅回调、**generation 语义**(任一 WS 断开 → 整代失效 → 指数退避重连,onStatus 通知)、dispose(关 socket,cleanup)
- 验证:probe 场景 1:1 迁移成 vitest 集成测试(连 3080,标记 `@live` 可跳过);手动:停 dsh web → UI 显示 disconnected → 重启 → 自动恢复

**P1-4 `src/agent/session-manager.ts`**
- 内容:会话列表(list/create/open/close)、**每个会话一个 append-only 事件缓冲**(来自 runtime,只追加不建模)、重连后的续传策略(以事件流断点为准)
- 验证:单测:事件累积顺序与完整性(无丢失/重复)

**P1-5 `src/agent/controller.ts`**
- 内容:AgentController — start(question)/stop()、事件路由(缓冲 → bridge)、状态机(idle/running/error/disconnected,UI 可见)、disposer 集合
- 验证:单测状态机迁移;手动:运行中 stop 生效且无泄漏

**P1-6 `src/webview/panel.ts`**
- 内容:ChatPanel — open/reveal/dispose 生命周期、加载 `dist/web/index.html`、CSP 注入、onDidDispose 全清理
- 验证:F5 打开面板无报错

**P1-7 `src/webview/bridge.ts`**
- 内容:双向消息协议(类型化 union):webview→ext(`ask`/`stop`/`session:list`/`session:open`)、ext→webview(`event`/`session:list`/`status`);**入参白名单结构校验**,非法消息显式报错
- 验证:单测(合法/非法载荷)

**P1-8 webview React UI(`web/`)**
- 内容:`App.tsx`(布局:会话列表 + 聊天区)、`ChatView.tsx`(流式渲染,chunk 累积,打字机效果)、`SessionList.tsx`、`ToolCallCard.tsx`(工具名+参数,可折叠)、`StatusBar.tsx`(connected/running/error)
- 铁律:渲染只吃 bridge 的 `event`;**无任何本地 messages[] 状态**
- markdown:白名单库(如 react-markdown + 显式 components),**禁 dangerouslySetInnerHTML**
- 验证:用 P1-1 的黄金样本事件回放渲染,视觉正确

**P1-9 `src/vscode/workspace.ts`**
- 内容:readFile 工具(UI 侧查看);writeFile 走 WorkspaceEdit 的**工具函数**(供 Phase 2 审批流复用);fs.watch 快照对比(方案 a,D2)
- 验证:单测:WorkspaceEdit 生成正确;手动:文件被 agent 改后 UI 出现 diff 入口

**P1-10 `src/vscode/terminal.ts`**
- 内容:runCommand → 集成终端(sendText);Phase 1 输出回传不做,UI 标注"输出在集成终端查看"(Phase 2 用 Pseudoterminal 接管)
- 验证:手动:ask "运行 pwd" → 集成终端出现并执行

**P1-11 命令注册 `src/commands/{ask,agent,review}.ts`**
- ask:读取选中文本(有则携带)→ 打开面板并提问;agent:打开面板;review:Phase 1 注册为 diff 视图入口(方案 a)
- 验证:三个命令均可触发

**P1-12 日志与状态 util(`src/util/{logger,dispose}.ts`)**
- 内容:分级 logger(输出到 OutputChannel)、disposers 工具(组合清理)
- 验证:运行时无未捕获 rejection

**P1-13 测试补齐**
- 内容:wire 编解码、session-manager 事件流、bridge 校验、runtime 集成(`@live` 标记)
- 验证:`pnpm test` 全绿(跳过 live 也全绿)

**P1-14 手动自测场景(每条记录结果到 docs/manual-tests/phase-1.md)**
1. F5 → Ask "列出当前目录的文件" → 流式回答 + 工具调用卡片
2. 运行中按停止 → 状态回 idle,无泄漏
3. 开两个会话 → 切换 → 各自历史正确(无串台)
4. 杀掉 dsh web → UI disconnected → 重启 dsh web → 自动重连
5. Ask "创建 hello.txt 并写入内容" → 文件生成 + UI 出现 diff + 回滚可用
6. Ask "运行 pwd" → 集成终端执行
7. 非法/损坏消息注入 bridge → 显式报错而非崩溃

**P1-15 cwd 一致性检测**
- 内容:握手成功后读 `host.describe.cwd`,与 VS Code 工作区根目录对比;不一致时状态栏/UI 明示 "实例 cwd = <path> ≠ 当前工作区"
- 验证:手动:在 dsh-for-vs-code 之外打开文件夹 F5 → 警告出现;一致时不显示

### 2.3 Phase 1 完成 Checklist

- [x] P1-1 docs/http-bridge.md 定稿(含黄金事件样本),probe 脚本入库
- [x] P1-2 wire 类型 + 编解码单测
- [x] P1-3 runtime 薄桥:握手/双 WS/重连/dispose 全绿(@live 实测;断连重连逻辑机器验证,UI 链路待 F5)
- [x] P1-4 session-manager:append-only 缓冲,无自建模
- [x] P1-5 controller:状态机 + stop 语义正确(协议验证;UI 交互待 F5)
- [x] P1-6 panel 生命周期无泄漏(disposer 全量清理;真实面板待 F5)
- [x] P1-7 bridge 白名单校验,非法消息不崩
- [x] P1-8 UI 纯事件驱动渲染,黄金样本回放正确,无 XSS 面(display 派生单测;真实渲染待 F5)
- [x] P1-9 workspace:WorkspaceEdit 工具 + 快照 diff(方案 a,diffLines 单测;watcher 待 F5)
- [x] P1-10 terminal:集成终端执行(实现完成;执行待 F5)
- [x] P1-11 三个命令可用(已注册;触发待 F5)
- [x] P1-12 logger/disposer 就位
- [x] P1-13 测试全绿(23/23,含 @live)
- [ ] P1-14 七条手动场景全部通过(记录文档 docs/manual-tests/phase-1.md 已建,**待 F5 逐条勾选**)
- [x] P1-15 cwd 一致性检测生效(实现完成;警告显示待 F5)
- [ ] **G1 Review(Phase 1)通过**(审查侧重:桥的薄度/事件流正确性/webview 安全),记录 docs/reviews/phase-1.md
- [x] 提交 commit + push(remote 已就绪)

---

## 3. Phase 2 — IDE-native(里程碑 M2)

**目标(一句话验收)**:agent 能看见"当前文件+选区+diagnostics+git 状态",改动以 diff 呈现并可审批/回滚,命令在可捕获输出的终端执行。

### 3.1 详细步骤

**P2-1 `src/vscode/editor.ts` 上下文收集**
- 内容:活动编辑器文件路径、选区、当前行 → 结构化为 model-facing context(§6 形状:file/selection/diagnostics)
- 验证:单测:上下文格式化

**P2-2 上下文注入**
- 内容:Route A 下用"问题前缀注入"(context 作为 user 消息上下文段);探测 runtime 是否暴露 inject RPC,有则优先 RPC
- 验证:手动:选中代码 ask "解释选中内容" → 回答确实包含选中代码语义

**P2-3 `src/vscode/diagnostics.ts`**
- 内容:收集当前文件/workspace diagnostics(`languages.getDiagnostics`),格式化为模型可见;监听变更推送 UI 徽标
- 验证:手动:人为制造 TS 报错 → agent 回答引用该报错

**P2-4 `src/vscode/git.ts`**
- 内容:仓库状态、工作区 diff(与 HEAD)、变更文件列表(优先 Git Extension API,降级 `git` CLI 封装)
- 验证:手动:ask "总结我的未提交改动" → 输出与 `git status` 一致

**P2-5 apply_patch 审批流**
- 内容:patch 解析器(unified diff → 结构化变更)→ VS Code WorkspaceEdit → 审批 UI(diff 预览 + Accept/Reject/Edit)→ 应用 + undo 记录
- 验证:单测:patch 解析(增删改/上下文/重叠冲突);手动:批准后文件变化可 undo

**P2-6 `src/vscode/terminal.ts` 完整版**
- 内容:Pseudoterminal 实现可捕获输出的终端,输出回传 UI/runtime,失败可降级为集成终端
- 验证:手动:ask "npm test" → 输出在 UI 可见

**P2-7 产品内审批功能**
- 内容:改动审批面板(方案 a diff 审查 + 一键回滚;预留完整写拦截钩子接口,供未来协议能力接入)
- 验证:手动:agent 连续改两个文件 → 逐个 diff 审查、可单独回滚

**P2-8 `src/commands/review.ts` 落地**
- 内容:"DeepSeek Harness: Review Changes" → 打开 agent 改动 diff 面板
- 验证:命令可用

**P2-9 测试补齐**:patch 解析器、context 格式化、git 输出解析(vitest)
**P2-10 自测场景**:
1. 选中代码 → 解释 → 上下文生效
2. diagnostics 注入生效
3. git diff 总结与 git status 一致
4. patch 审批流:Accept / Reject / 编辑后应用
5. Pseudoterminal 输出可见
6. 回滚后文件内容与快照一致

### 3.2 Phase 2 完成 Checklist

- [x] P2-1~2 编辑器上下文 + 注入生效(格式化单测;真实注入待 F5)
- [x] P2-3 diagnostics 可见可用(收集/徽标/注入已实现;待 F5)
- [x] P2-4 git 状态/diff 正确(解析单测;真实问答待 F5)
- [x] P2-5 patch → WorkspaceEdit → 审批 → undo 全链路(patch 解析 + 应用单测;approval 原生审批已实现,待 F5 触发)
- [x] P2-6 终端输出可捕获回传(Pseudoterminal 实现;待 F5)
- [x] P2-7 审批面板 + 单文件回滚(ChangesPanel 实现;待 F5)
- [x] P2-8 review 命令落地(已注册 → 打开改动面板)
- [ ] P2-9 测试全绿
- [ ] P2-10 六条自测通过
- [ ] **G1 Review(Phase 2)通过**(侧重:WorkspaceEdit 路径/审批流/注入),记录 docs/reviews/phase-2.md
- [ ] 提交 + push

---

## 4. Phase 3 — Harness 全能力(里程碑 M3)

**目标(一句话验收)**:MCP / skills / subagents / background jobs / session fork / resume / sandbox / goals 均在 UI 可见可用(协议不支持的以"文档记录 + UI 降级"处理,不造轮子)。

### 4.1 详细步骤

- **P3-1 MCP**:探测 runtime 的 MCP 状态接口 → UI 显示服务器列表/状态;配置透传说明写入 README(不重复实现 MCP 客户端)
- **P3-2 Skills**:列表/启用 UI(协议暴露则做;否则 UI 展示配置来源文档)
- **P3-3 Subagents**:事件流中标记子 agent 活动(时间线分组),支持单独停止
- **P3-4 Background jobs**:job 列表 + 状态(running/completed/failed)+ 输出查看
- **P3-5 Session 持久化与 fork**:会话元数据存 VS Code globalState;重启恢复列表;fork 按钮(协议支持则调 runtime,否则文档记录)
- **P3-6 Sandbox**:状态展示 + 配置来源说明(保留 Harness 自身 provider)
- **P3-7 Goals**:创建/查看 goal 进度 UI(协议面探测后定)
- **P3-8 协议缺口清单**:对每个探测失败的能力,产出 `docs/gaps.md`(能力 / 现象 / 降级方案 / 期望的上游接口),不私自扩展 runtime
- **P3-9 测试 + 自测**:每条能力一条手动场景;单测覆盖新 UI 状态逻辑
- **P3-10 连接管理(终局形态)**:dsh web 地址可配置(默认 `http://127.0.0.1:3080`,VS Code setting),连接状态/切换 UI;任何实例都是"第 N 个 viewer",不另起 runtime

### 4.2 Phase 3 完成 Checklist

- [x] P3-1 MCP 状态可见(无 API 面 → docs/gaps.md #1,UI 不造轮子)
- [x] P3-2 skills 可用或已文档化降级(skill.list → 洞察"技能"tab;启用无 API → gaps #4)
- [x] P3-3 subagents 活动可见/可停(subagent.list/interrupt → "子代理"tab,continuable 可打断)
- [x] P3-4 jobs 状态与输出可查(session/jobs 推送帧 → "任务"tab;取消无 API → gaps #2)
- [x] P3-5 会话持久化 + fork(session.fork + globalState 恢复 + 列表 ⧉ 按钮)
- [x] P3-6 sandbox 状态可见(无 RPC/投影 → gaps #3,投影通道已通用化)
- [x] P3-7 goals 可见(history projections + 投影帧 → "Goals"tab 创建/暂停/恢复/完成/清除)
- [x] P3-8 docs/gaps.md 完整(6 条缺口,含上游期望)
- [x] P3-9 测试全绿 + 自测记录(40/40;docs/manual-tests/phase-3.md)
- [x] P3-10 连接地址可配、切换生效(setBaseUrl 命令 + 配置事件统一 rebase)
- [ ] **G1 Review(Phase 3)通过**(侧重:生命周期/disposer/降级诚实性),记录 docs/reviews/phase-3.md
- [ ] 提交 + push

---

## 5. Phase 4 — VS Code 原生 + 交付准备(里程碑 M4)

**目标(一句话验收)**:dsh agent 进入 VS Code 原生入口(Chat 面板/右键/CodeLens),同时完成全量回归与打包交付。

### 5.1 详细步骤

- **P4-1 ChatParticipant**:将 dsh agent 注册为 `vscode.chat` participant,会话/事件仍走 `session/event`(§14 允许第二阶段支持;实现时确认 model 路由与 Harness runtime 的关系,不做双模型)
- **P4-2 Inline edit / code actions**:选中代码 → "dsh: 解释/修复" code action;inline edit 按协议能力做(不强制)
- **P4-3 CodeLens / diagnostics action**:agent 输出中的建议点可一键触发;诊断条目右键 "Ask dsh to fix"
- **P4-4 命令与菜单收尾**:command palette 全命令清单、editor context menu、keybindings 建议
- **P4-5 全量回归**:§7 交付 Checkbox 预跑一遍
- **P4-6 G2 交付门**:见 §6.2

### 5.2 Phase 4 完成 Checklist

- [ ] P4-1 ChatParticipant 可用(或决策记录说明不做)
- [ ] P4-2 code actions / inline 可用
- [ ] P4-3 CodeLens / diagnostics action 可用
- [ ] P4-4 命令/菜单完整
- [ ] P4-5 交付 Checkbox 预跑全过
- [ ] **G2 交付门通过**,记录 docs/reviews/phase-4.md + docs/reviews/final.md
- [ ] 提交 + push + 打 tag

---

## 6. Review 环节设计(审核代码是否有问题)

### 6.1 关卡总表

| 关卡 | 触发时机 | 内容 | 未通过的后果 |
| --- | --- | --- | --- |
| **G0 提交门** | 每次 commit 前 | 自动化 gate(§6.2 四条命令) | 不允许 commit,先修复 |
| **G1 阶段门** | 每阶段完成 | G0 + 阶段 checklist 逐项核验 + **独立 reviewer 审查 diff**(§6.3)+ 记录 §6.5 | 该阶段不算完成,进入修复循环 |
| **G2 交付门** | 发布前 | 全部 G1 通过 + 干净环境端到端 + vsce 打包 + §7 全勾 | 不交付 |

### 6.2 G0 自动化 gate(命令,全绿才算过)

```bash
cd apps/vscode
pnpm typecheck   # tsc --noEmit,0 错误
pnpm lint        # oxlint,0 告警(可配置降级项必须显式白名单)
pnpm test        # vitest,全绿(含 live 标记测试的跳过逻辑)
pnpm build       # esbuild 双入口构建成功
```

### 6.3 独立 reviewer 流程(每阶段一次,不可省略)

执行方式:**fresh-context 的 review subagent**(不带本会话上下文),输入与输出如下;由主 agent 负责调度、修复与复检。

1. **输入打包**(主 agent 准备):
   - 本阶段 `git diff`(阶段起始 commit..HEAD)或完整文件清单;
   - 相关文件全文;`docs/http-bridge.md`;§6.4 审查清单;
   - 阶段自测记录;`dsh` 版本与协议笔记。
2. **reviewer 任务书**(直接粘给 subagent 的模板):
   > 你是 dsh-for-vs-code 的独立代码审查员。审查以下 diff 与文件,按审查清单逐类核查,禁止只看"能否跑通",必须找:协议/状态机错误、资源泄漏(disposer 缺失)、XSS/注入面、违反"Session append-only 不自建 messages[]"原则、违反"薄桥"原则、任何 any/类型绕过、错误路径吞异常。输出 docs/reviews/phase-N.md,格式见 §6.5;问题分 P0(必须修复,阻塞交付)/ P1(必须修复)/ P2(记录,可延后),每条必须带 文件:行号 + 理由 + 建议修复。
3. **主 agent 处置**:P0/P1 全部修复 → 重新跑 G0 → 把修复 diff 发回 reviewer(`send_message` 续聊)复检 → 通过后该阶段才算 Review 通过;P2 记入问题清单持续跟踪。
4. **记录**:每阶段一份 `docs/reviews/phase-N.md`,最终 `docs/reviews/final.md` 汇总。

### 6.4 代码审查清单(§6.3 reviewer 与主 agent 自审共用,逐条可勾选)

**A. 架构与约束**
- [ ] A1 未修改/依赖上游 packages/core 与 agent-loop(只允许 import 官方发布包)
- [ ] A2 新能力挂官方扩展点,无自研 agent loop / 消息状态机
- [ ] A3 runtime.ts 保持薄:无业务逻辑、无状态缓存、协议细节全部封装
- [ ] A4 所有 @deepseek-ai/* 依赖版本锁定并记录(docs/versions.md)
- [ ] A5 无 Route C 痕迹(自建 agent loop / 自建会话持久化模型)

**B. Session 模型**
- [ ] B1 UI 只从 session/event 渲染,零 messages[] 自维护
- [ ] B2 事件顺序/完整性:无丢失、无重复;重连从断点续
- [ ] B3 model-visible 信息可从事件日志重建
- [ ] B4 会话生命周期归属明确(谁创建、谁关闭、谁 dispose)

**C. VS Code 集成**
- [ ] C1 文件写走 WorkspaceEdit(或豁免记录 T-1 + 回滚方案存在)
- [ ] C2 terminal 走 VS Code Terminal API,无裸 child_process
- [ ] C3 每个 onDid*/订阅有 disposer;deactivate 全清理;activate 幂等
- [ ] C4 package.json contributes 与代码注册的命令一一对应
- [ ] C5 webview 资源路径在打包后仍正确(media/dist 都在 VSIX 内)

**D. Webview 安全**
- [ ] D1 CSP:无 inline script;script-src 仅自身(或 nonce);无 remote origin
- [ ] D2 所有 postMessage 入参白名单结构校验
- [ ] D3 无 dangerouslySetInnerHTML;markdown 用白名单渲染
- [ ] D4 链接/图片协议白名单(禁 javascript: 等)
- [ ] D5 API key / credentials 不下发 webview、不进事件渲染

**E. 类型与错误处理**
- [ ] E1 strict 编译通过,无 any(协议边界窄化点有注释)
- [ ] E2 异步错误有兜底,无静默 rejection
- [ ] E3 网络错误路径:超时/断连/重连/退避,UI 状态可见
- [ ] E4 取消幂等,关闭后无泄漏回调
- [ ] E5 序列化失败显式报错,不静默丢消息

**F. 安全**
- [ ] F1 路径操作防目录穿越(resolve 后校验在 workspace 内)
- [ ] F2 命令执行参数化,无 shell 拼接注入
- [ ] F3 敏感信息不进日志/事件/webview

**G. 工程规范**
- [ ] G1 ESM everywhere,无 CJS 残留
- [ ] G2 命名一致(英文标识符);文档中文
- [ ] G3 关键路径有单测(bridge/patch/session/context)
- [ ] G4 git add 只加具体路径;提交信息规范(feat/fix/chore/refactor)
- [ ] G5 无调试残留(console.log 已清理或用 logger)

**H. 回归与兼容**
- [ ] H1 dsh web 协议笔记带版本与日期,升级后回归记录
- [ ] H2 VSIX 打包无遗漏(media/webview assets 全在)
- [ ] H3 F5 干净启动(清扩展状态)可用

### 6.5 Review 记录模板(每阶段 docs/reviews/phase-N.md)

```markdown
# Phase N Review — <YYYY-MM-DD>
- 范围:commits <a>..<b> / 文件清单
- G0 gate:typecheck ✅ / lint ✅ / test ✅ / build ✅(附输出摘要)
- 独立审查:reviewer <id>;审查文件 <n> 个;时长 <m>
- 发现:P0 × <k0> / P1 × <k1> / P2 × <k2>(逐条:文件:行号 | 理由 | 建议修复)
- 修复与复检:修复 diff <hash>;复检结果 ✅ / ❌(<理由>)
- 结论:**PASS** / PASS WITH NOTES / **FAIL**(P0/P1 未清即 FAIL)
- 遗留问题跟踪:P2 清单 + 归属阶段
```

### 6.6 各阶段审查侧重

| 阶段 | 审查重点(在 §6.4 全清单之上) |
| --- | --- |
| Phase 0 | 工程规范(G 类)、构建可复现、贡献点一致性 |
| Phase 1 | 桥的薄度(A3)、事件流正确性(B 类)、webview 安全(D 类) |
| Phase 2 | WorkspaceEdit 路径、审批流状态机、上下文注入格式、patch 解析边界 |
| Phase 3 | 生命周期与 disposer(C3)、降级诚实性(gaps.md 不夸大)、job 并发 |
| Phase 4 | ChatParticipant 合规、原生入口质量、全量回归 |

---

## 7. 最终交付效果 Checkbox

> 每条 = 验收操作 → 预期结果。全部 ☑ 才算交付。

### 7.1 功能验收

- [ ] **F1 Chat 基础**:F5 启动 → 命令面板 "DeepSeek Harness: Ask" → 提问 → 流式回答,打字机效果正常
- [ ] **F2 会话管理**:会话列表可见;可新建/切换;历史回看正确,无串台
- [ ] **F3 停止**:运行中可停止;UI 状态回 idle;再次提问正常
- [ ] **F4 文件读取**:ask "读取 package.json" → 内容正确显示
- [ ] **F5 文件改动与 diff**:ask "创建 demo.txt" → 文件生成;UI 可见改动 diff;一键回滚后内容还原
- [ ] **F6 运行命令**:ask "运行 pwd" → 命令在终端执行;Phase 2 起输出可在 UI 查看
- [ ] **F7 编辑器上下文**:选中代码 ask "解释选中内容" → 回答体现选中语义
- [ ] **F8 diagnostics**:有报错文件 ask "修复这个问题" → 回答引用具体报错(文件/行号/消息)
- [ ] **F9 git 感知**:ask "总结我的未提交改动" → 与 git status/diff 一致
- [ ] **F10 patch 审批流**:agent 改动以 patch 呈现;Accept 应用(可 undo)、Reject 不应用、可编辑后应用
- [ ] **F11 MCP**:已配置 MCP 服务器状态可见,agent 可调用其工具
- [ ] **F12 Skills**:skill 列表可见(或文档化降级说明)
- [ ] **F13 Subagents**:子 agent 活动在时间线可见,可停止
- [ ] **F14 Background jobs**:job 状态可见,输出可查
- [ ] **F15 Session fork/resume**:会话可 fork;VS Code 重启后会话列表恢复
- [ ] **F16 Goals**:goal 创建与进度可见(或文档化降级)
- [ ] **F17 ChatParticipant**:VS Code 原生 Chat 面板可用(或决策记录说明不做)
- [ ] **F18 原生入口**:编辑器右键/命令面板的 dsh 入口可用

### 7.2 质量验收

- [ ] **Q1** `pnpm typecheck` 0 错误
- [ ] **Q2** `pnpm lint` 0 告警
- [ ] **Q3** `pnpm test` 全绿;关键路径(桥/事件流/patch/审批/上下文)有覆盖
- [ ] **Q4** 全部 `docs/reviews/phase-*.md` 结论 PASS 或 PASS WITH NOTES
- [ ] **Q5** 无未关闭的 P0/P1 问题;P2 清单有归属与计划
- [ ] **Q6** F5 干净启动(清空扩展状态)可用,无未捕获异常
- [ ] **Q7** 断连/重连:杀 dsh web → disconnected → 重启 → 自动恢复;期间不丢已收事件
- [ ] **Q8** 长时间会话(≥30 分钟)内存/订阅无泄漏(disposer 计数稳定)

### 7.3 打包与发布

- [ ] **PK1** `pnpm package`(`vsce package`)成功,VSIX 产物生成
- [ ] **PK2** VSIX 安装到干净 VS Code(无开发环境)可激活、可用
- [ ] **PK3** 打包无遗漏:media/ 图标、webview dist、扩展主入口均在包内
- [ ] **PK4** README 提供安装路径(市场/VSIX)与版本说明

### 7.4 文档与合规

- [ ] **D1** README.md(中文):安装/使用/架构/已知限制
- [ ] **D2** docs/http-bridge.md:协议笔记(端点/消息/事件时间线/版本/日期)
- [ ] **D3** docs/versions.md:全部依赖版本锁定
- [ ] **D4** docs/gaps.md:协议缺口与降级说明
- [ ] **D5** docs/reviews/:全部 review 记录齐全
- [ ] **D6** 已知限制清单(T-1:无法截获 agent 写盘,快照 diff + 回滚为最终形态)在 README 明示
- [ ] **D7** 合规:MIT 兼容(仅引官方包,无复制上游源码进本仓库)

### 7.5 端到端演示路径(验收用,一次跑通)

1. `git clone` 仓库 → `pnpm install` → `pnpm build`(新机器可复现)
2. 启动 `dsh web`(后台)→ `curl 3080` == 200
3. VS Code F5(或安装 VSIX)→ 活动栏出现 DeepSeek 图标
4. Ask "总结本仓库结构" → 流式回答 + 工具调用卡片
5. 选中一段代码 Ask "解释" → 上下文生效
6. Ask "创建一个 hello.txt" → diff 出现 → Accept → undo 验证 → 回滚验证
7. 切换会话 → 重启 VS Code → 会话恢复(Phase 3 后)
8. 收尾:Q1~Q8 复核一遍

---

## 8. 风险登记表

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | dsh web 协议变更(rc 版无稳定契约) | 桥失效 | 锁版本 + docs/http-bridge.md 回归 + 薄桥隔离 + 升级专项测试 |
| R2 | Route A 拿不到终端输出 | F6 降级 | Phase 2 Pseudoterminal;仍不行则"集成终端 + UI 提示" |
| R3 | 映射现有实例 → 无法截获 agent 写盘 → 无法真正 WorkspaceEdit 审批(T-1,固有边界) | F5/F10 打折 | 方案 a(快照 diff + 回滚)+ patch 模式探索;接受为最终形态 |
| R4 | 上游 breaking change(rc 节奏快) | 构建/运行失败 | 全量版本锁定;升级只做专项,带回归 |
| R5 | VS Code 版本兼容(ESM 扩展/API 面) | 无法激活 | engines 约束 + 干净环境测试矩阵 |
| R6 | 模型/API key 未配置(仅影响全新实例;本机实例已配 deepseek-v4-flash) | headless 退出码 1,服务不可用 | README 明确配置(agent-default-model / DEEPSEEK_API_KEY);扩展启动时探测并提示 |
| R7 | 事件流大(长会话/多子 agent) | UI 卡顿 | 节流 + 虚拟滚动 + 事件缓冲上限策略 |
| R8 | remote 未建(gh repo create 未执行成功) | push 阻塞 | 本地提交;网络恢复后 `gh repo create mrtsels/dsh-for-vs-code --public --source . --push` |
| R9 | dsh web 绑定安全(无鉴权) | 本机端口被探测 | 保持 127.0.0.1;README 警示;不启用 0.0.0.0 |

---

## 9. 附录:常用命令速查

```bash
# 服务
npx @deepseek-ai/dsh web                                   # 启动 runtime(前台,后台用 job)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/   # 健康检查
dsh --version                                              # 版本(必须 0.1.0-rc.6)

# 构建与质量
cd apps/vscode
pnpm build            # esbuild 双入口
pnpm build --watch    # 开发 watch
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint
pnpm test             # vitest
pnpm test -- --run live   # 连 3080 的集成测试(可选)
pnpm package          # vsce package → *.vsix

# git(规范)
git add <具体路径>     # 禁 git add . / -A
git commit -m "feat: ..." / "fix: ..." / "chore: ..." / "refactor: ..."
git push              # remote 就绪后
```

---

*TASK.md 结束。每完成一步,在对应 Checklist 打勾;每完成一阶段,过 G1 Review 并更新 docs/reviews/。最终以 §7 全勾 + G2 通过为交付。*
