# 询问提示词:VS Code 扩展「原生文件/选区附着」技术实现细节

> 用途:把本文档整体复制粘贴给一个高级模型(Claude / DeepSeek / GPT),请其给出**可直接落地**的
> 技术实现细节。你的答复将直接驱动本项目(仓库:dsh-for-vs-code)的 Phase 10 实施。

---

## 一、你的角色与任务

你是 VS Code 扩展开发专家。请为一个 VS Code 扩展设计以下三个功能的**具体技术实现方案**,
要求精确到 VS Code API 名称与签名、事件流、需要新增/修改的文件与消息类型、边界情况表、
风险与备选方案。**不需要完整代码库**,但每个关键点都要给出可直接照抄的 TS 代码骨架
(ESM,TypeScript strict)。凡是依赖版本/环境行为、你无法 100% 确认的点,必须明确标注
「需实测」并给出验证方法(如 headless drop 事件模拟、VS Code 内 F5 手测)。

三个功能(详见第四节):
1. **原生可拖拽**:从 VS Code Explorer 拖文件到扩展 webview 的对话输入区 → 附着为待发送上下文。
2. **可选附着活动文件**:用户可选择是否把 VS Code 当前打开的文件内容随消息附着发送。
3. **可选附着活动选区**:用户可选择是否把当前打开文件中已选中的文本(含行列)随消息附着发送。

## 二、项目背景(请基于这些事实回答,不要假设)

- 本扩展是 **dsh(DeepSeek Harness)web 实例(127.0.0.1:3080)的客户端**:不内嵌 runtime,
  只把浏览器版 Web UI 换成 VS Code Extension + Webview。UI = dsh 上游 React 组件
  (从锁定 rev 的 vendor 源码构建装配,产物在 `apps/vscode/dist/web/dsh-shell/`),经
  `src/vscode/proxy.ts` 的扩展进程内 HTTP+WS 转发代理连接实例(webview 直连 3080 会被
  Origin 栅栏 403)。
- **上游 UI 完全冻结**:红线规定不 fork 上游、不改 `vendor/deepseek-harness` 内任何源码。
  因此对话输入框(上游 ui-conversation 的输入组件)**本身没有、也不允许加**附着/拖放能力;
  所有自定义 UI 只能走「桥注入」模式(见第五节),包括:
  - 装配时注入 nonce 脚本(build-web-shell.mjs + shell-html.ts,`__DSH_*` 运行时变量);
  - webview 内 document 级 capture 事件监听 + MutationObserver 重插(上游 React 重渲染会
    清除注入节点,参照已实现的「会话切换按钮 title 行注入」「会话管理页 #dsh-sessions-root」);
  - postMessage 白名单协议(见 `src/webview/bridge.ts`)。
- **运行时只有文本消息**:dsh 运行时/协议无附件 RPC,消息即文本。因此「附着文件」的语义 =
  把文件内容/路径以文本块形式注入到发送给模型的 user 消息中(现有机制参考:
  `askWithContext` 用 `formatEditorContext` 把 `<editor-context>` 前缀块注入问题文本)。
- CSP:`default-src 'none'`,script 只能 nonce + unsafe-eval(上游 vite 产物所需),
  connect 仅 127.0.0.1:3080 与代理地址;无 inline 事件处理器(禁 ondrop="..."),必须
  addEventListener;禁 `dangerouslySetInnerHTML`(需白名单渲染)。
- 扩展引擎 `engines.vscode: ^1.95.0`,Node ^22.19。技术栈:TS strict / ESM / vitest /
  esbuild / oxlint。

## 三、红线与硬约束(方案必须遵守)

1. 不改 vendor/上游源码;不自维护 messages[] 副本;model-visible ⟺ logged。
2. webview 不能直读文件系统:文件内容一律由扩展侧读取(`vscode.workspace.fs` /
   `fs/promises`),webview 只传 URI/路径与开关状态。
3. 新增 webview ↔ 扩展消息必须进 `src/webview/bridge.ts` 的类型化 union 并在
   `validateWebviewRequest` 加白名单结构校验(非法载荷显式抛错,不静默放行)。
4. 注入的 UI 不得破坏上游输入框的焦点/Enter 快捷键/滚动;chip 渲染文件名必须转义。
5. 文件/选区内容必须有大小上限与截断策略(现状:选区 20k 字符截断)。
6. 开关类偏好写 VS Code 设置(`package.json` contributes.configuration 加键),不写运行时状态。
7. 订阅一律返回 disposer 并随扩展 deactivate 清理;注册即 effect。

## 四、三个需求与验收标准

### 需求 1:Explorer 文件原生拖入附着
从 VS Code Explorer 拖 1~N 个文件到 webview 对话输入区域(可包括从 OS 桌面/访达拖入):
- 拖入过程中输入区有高亮反馈(dragenter/dragover/dragleave);
- drop 后每个文件变成一张可移除的「附着 chip」(文件名 + 大小/语言),多文件可叠加;
- 发送消息时,附着文件的内容(或路径,按你建议的策略)作为文本块随消息进入模型;
- 与上游输入框共存:不抢焦点、不拦截上游自身的点击/拖拽行为、chip 不被上游重渲染清除。

### 需求 2:可选附着「正在打开的文件」
- 用户可开关(设置 + webview 内 UI 指示,指示方式请你设计,可复用注入模式);
- 开启后,每次发送消息自动附带当前活动编辑器(`vscode.window.activeTextEditor`)的
  文件内容,**包含未保存的编辑改动**;`document.getText()` 即当前缓冲区;
- 无活动编辑器/文件不可读时:开关自动禁用,发送时跳过且对用户可见;
- 内容上限与截断策略与现状一致(20k 或你建议的更优策略)。

### 需求 3:可选附着「已选中的内容」
- 用户可开关;开启后自动附带当前活动编辑器中**选中文本 + 起始/结束行列**(1-based);
- 选区变化实时反映(切换文件、拖选、多光标);空选区时自动禁用;
- 与需求 2 同时开启时:合并策略由你设计(优先级、去重、格式)。

## 五、现状盘点(已核实的代码事实,方案应复用而非重造)

关键文件(均在仓库 `apps/vscode/` 下):

| 文件 | 现状 |
| --- | --- |
| `src/webview/bridge.ts` | webview ↔ 扩展消息协议:类型化 `WebviewRequest`(webview→扩展,如 `ask`/`dsh:new-session`/`switch-session:applied`)与 `ExtensionMessage`(扩展→webview,如 `error`/`state`/`event`);`validateWebviewRequest` 白名单结构校验。**新消息类型必须加到这里** |
| `src/webview/shell-html.ts` | webview HTML 装配纯函数:head 插 CSP(`default-src 'none'` + nonce + unsafe-eval)+ base;body 开标签后插 `__DSH_WEB_URL__`/`__DSH_BOOT_SESSION__`/`__DSH_HOST__`/`__DSH_LOCALE__` nonce 脚本 + boot。**注入新的运行时变量/启动脚本在这加** |
| `src/webview/chat-panel.ts` | `ChatPanel`(WebviewViewProvider + WebviewPanel 双宿主):`buildHtml` 读 dsh-shell 产物装配 HTML;`onDidReceiveMessage` 路由(debug 通道、switch-session:applied 重载、其余交 `onRequest`)。**扩展侧消息处理的挂载点** |
| `src/extension.ts` | `activate`:组装 runtime/sessions/controller/双面板/proxy/设置桥;`handleRequest` 按 request.type 分发;`askWithContext` 在发消息前做上下文注入(见下) |
| `src/vscode/editor.ts` | `collectEditorContext(workspaceRoot)`:`vscode.window.activeTextEditor` → 文件相对路径(`workspace.asRelativePath`,工作区外用绝对路径)+ 选区 `SelectionInfo{startLine,startCol,endLine,endCol,text}`(非空选区才取,20k 截断) |
| `src/agent/context.ts` | `EditorContext` 形状与 `formatEditorContext`:输出 `<editor-context>` 前缀块(file/selection 行 + fenced block) |
| `src/commands/ask.ts` | `deepseekHarness.ask` 命令:读选中文本(有则携带)→ 打开面板 → 提问(独立于 webview 输入的注入路径) |
| `apps/vscode/package.json` | `contributes.configuration` 已有 baseUrl/locale/theme/permissionMode/agentPreset/busyEnter 设置键;`contributes.commands` 已有 deepseekHarness.* 命令。**新设置/命令键加这里,命令 id 统一 `deepseekHarness.*` 前缀** |
| `scripts/build-web-shell.mjs` | 装配脚本:SHELL_CSS 注入(布局/主题)、bridge.js(webview 预加载桥,持有唯一 `acquireVsCodeApi`,`window.__dshBridge.postToHost`)、session-view.js 注入 `#dsh-sessions-root`。**注入型 JS 的构建入口;webview 侧自研代码在这装配或经 esbuild 出 IIFE** |
| `web/SessionView.tsx` | 扩展自有 React 视图范式:经 `window.__dshBridge.postToHost` 回传宿主(不可二次 acquireVsCodeApi)、`__DSH_WEB_URL__` 代理调 session.list RPC |
| `test/shell-html.test.ts` 等 | vitest 单测;冒烟 `scripts/smoke-shell.mjs`(headless Chrome + Origin 中继,白屏/布局/交互断言) |

现有注入范式(已落地、可复用,请在方案中沿用):
- **会话切换按钮 title 行注入**:上游组件重渲染清除注入节点 → MutationObserver(rAF)重插 +
  document capture 事件委托(按钮移除瞬间点击仍命中)。
- **会话管理页**:扩展自有 React 视图注入 `#dsh-sessions-root` + bridge 切 `chat`↔`sessions`
  (sessions 时 `#root` display:none 保 store);数据经 `__DSH_WEB_URL__` 代理调 RPC。
- **设置桥**:VS Code 设置 ↔ dsh 实例设置双向同步(settings.update 写回 + 轮询)。

## 六、需要你回答的具体问题

### A. Explorer → webview 拖放(需求 1 的核心)

A1. **MIME 与载荷**:VS Code 在 webview 的 `DataTransfer` 中注入的 Explorer 拖拽 MIME 类型
   确切名称是否就是 `vscode.Resource`?其载荷的确切 JSON 形状(URI 数组?每个元素是
   字符串还是对象?)给出解析代码骨架(容错:VS Code 版本差异)。
A2. **监听挂点**:webview 内监听拖放事件的正确位置与阶段(document 级 capture?输入区容器?
   为什么?);`dragover`/`drop` 是否必须 `preventDefault()`(不 preventDefault 的后果);
   已知坑:CustomEditor 类 webview 的 Explorer 拖放曾失效(microsoft/vscode#182449),该坑对
   普通 `WebviewView`(侧边栏)是否适用?如何规避/降级?
A3. **OS 桌面文件**:从访达/桌面拖入时 DataTransfer 里是 `Files` 还是 `text/uri-list`?
   webview iframe 内能否用 `webUtils.getPathForFile(file)` 取真实路径(自哪个 VS Code
   版本可用?受不受 CSP 影响?);若不可用,可靠备选(如 readFile 仅限 text/uri-list,
   或要求用户走 Explorer)?
A4. **多文件/文件夹**:多文件如何保持顺序去重;拖入文件夹如何识别(uri scheme?
   扩展侧 `vscode.workspace.fs.stat` 判断 directory?)是否递归展开文件夹?建议的行为。
A5. **内容送达**:拖放后 chip 只存 URI → 发送时扩展侧读文件(`vscode.workspace.fs.readFile`)
   并以何种形式注入(全文 fenced block?仅路径?大小阈值内全文、之外仅路径?);二进制/
   超大文件检测(读前按 size、读后按空字节/语言);建议的上限数值与策略。
A6. **拖放 UI 反馈**:dragenter/dragover/dragleave/drop 高亮样式(输入区边框/遮罩),与上游
   React 输入区共存(不破坏 textarea 焦点),以及「拖入即出现可移除 chip」的 DOM 位置。

### B. 附着活动文件(需求 2)

B1. **精确 API 与订阅**:`vscode.window.activeTextEditor`;`onDidChangeActiveTextEditor` /
   `onDidChangeVisibleTextEditors` / `onDidCloseTextEditor`(哪些够用?各事件语义);
   订阅返回 Disposable 的注册位置(extension.ts?新模块?)。
B2. **读取**:`editor.document.getText()` 是否含未保存改动(请确认);`languageId`;
   `workspace.asRelativePath` 在多根工作区/工作区外文件的正确用法(现状:工作区外退化为
   绝对路径);untitled 文件如何处理。
B3. **开关与 UI**:设置键设计(键名/类型/默认值/枚举描述,放进 `contributes.configuration`);
   开关状态如何同步到 webview(新增 `ExtensionMessage` 类型?);webview 内 UI 指示的
   注入形态(输入区上方一条可点击 chip 栏?状态点?)与「点击切换」的交互;
   是否同时提供命令(`deepseekHarness.*`)与 statusbar。
B4. **注入时机与形式**:发送时快照(推荐?)vs 实时绑定;注入块与现有 `<editor-context>`
   的关系(需求 2/3 开启时替代、合并还是并存?);建议的格式(fenced block +
   `file:` 行 + `language:` 行)。注入点在 `askWithContext`(扩展侧,webview `ask`
   消息到达后)还是别处?

### C. 附着活动选区(需求 3)

C1. **精确 API**:`editor.selection` vs `editor.selections`(多光标);`document.getText(sel)`;
   `onDidChangeTextEditorSelection` 订阅 + 防抖(建议节流参数);1-based 行列转换
   (现状 `SelectionInfo` 已做 +1,请确认算法)。
C2. **状态联动**:空选区/选区被清空/切换文件/切换光标时 UI 与注入行为;与需求 2 同时开启时
   的合并与去重;选区内容变化时 chip 如何显示(「文件:行 x-y」)。
C3. **上限**:选区 20k 字符截断是否合理;超长时注入截断提示的格式;多光标选区怎么拼。

### D. 横切:协议、UI 注入、安全、测试

D1. **消息类型设计**:新增 `WebviewRequest` 与 `ExtensionMessage` 的具体 union 成员
   (字段/类型/长度上限),并给出 `validateWebviewRequest` 的校验骨架;「附着状态」查询/
   推送的时序(webview ready 后如何拿到初始开关与当前活动文件状态)。
D2. **注入脚本与 DOM 共存**:chip 工具栏 DOM 结构与 CSS(放哪个容器、类名命名、写入
   shell.css 还是运行时注入 style?);MutationObserver 重插策略(观察哪个节点、rAF 防抖);
   document capture 事件委托清单;如何保证不抢 textarea 焦点/Enter;上游 React 重渲染的
   具体触发点(消息流式输出?会话切换?)对 chip 存活的影响。
D3. **安全**:CSP 合规(nonce 脚本、addEventListener、禁 inline handler);chip 文件名/路径
   渲染转义;附着内容总大小上限;工作区外文件拖入的信任边界与提示;是否涉及把文件内容
   发到本地实例外(不涉及,本地实例,但请说明取舍)。
D4. **测试**:vitest 单测点清单(纯函数:DataTransfer 解析、注入块格式化、白名单校验、防抖);
   smoke-shell.mjs 扩展断言(headless Chrome 里如何**模拟 drop 事件**注入 `vscode.Resource`
   MIME —— 请给出可行性方法与最小代码);@live 集成测试;手动测试清单项(拖放真机验证、
   未保存改动附着、多根工作区)。
D5. **版本兼容**:`^1.95.0` 下 `webUtils`(若涉及)、`onDidChangeVisibleTextEditors`、
   `workspace.fs` 等 API 的可用性确认;若某 API 需要更高版本,给出降级路径。

## 七、输出格式要求

1. 按 **A / B / C / D** 四节组织,每节:结论先行 → API 签名/常量(TS)→ 事件流(编号步骤)→
   代码骨架(ESM + strict,可直接照抄)→ 边界情况表 → 风险与备选。
2. 最后给一节「**实施顺序建议**」:三步功能的依赖关系、每步的验收要点、建议的 commit 拆分
   (feat 前缀)。
3. 所有「需实测」点集中列一张表(现象/验证方法/影响面)。
4. 篇幅不限,但要可执行;不要泛泛而谈,不要给与第四节验收标准无关的建议。

