# TASK.md — dsh-for-vs-code 实施任务书(2026-08-17 重写:Route A 源码构建路线)

> 本版重写原因(2026-08-17 用户决策):
>
> 1. **执行基准漂移**:08-15 版(Phase 5–8,vendor submodule + 定制 boot 图)方向正确,但此后实际走了
>    "fetch dist + 注入 boot 桥"路线(fetch-dsh-ui.mjs),TASK.md 未同步、checkbox 全空;README(Phase 0–4)
>    与 refactor-requirements(P0/P1/P2)又各是一套进度说法。
> 2. **fetch+boot 被判定不靠谱**(用户决策,对比 references/deepseek-harness-vscode 112GT 路线后):
>    产物对着活 3080 抓取、不可复现;debugBridge 以模板字符串注入上游 minified shell(转义坑已两次咬人,
>    见 AGENTS.md Pitfalls);背景透明靠 getComputedStyle DOM 启发式;webview 直连撞 Origin 栅栏要靠
>    扩展侧代理改写。**决策:改为 Route A —— 从锁定 rev 的 vendor 源码构建全部前端产物,自产
>    index.html 与 __DSH_BOOT__ 图;唯一适配缝 = connection resolveBase 断言式替换。**
> 3. 112GT 参考路线(vendored runtime + spawn sidecar + 自研 chat UI)违反本仓库红线
>    (Route B 内嵌 runtime / X-5 API key 进扩展 / R-A2 自研 UI),不采纳其架构;仅借鉴工程骨架
>    (AgentRunner 抽象、状态机 logTail、权限三档、编辑器改动装饰 —— 后者已实现)。

## 0. 目标与路线

### 0.1 目标

VS Code 扩展作为本地 dsh web 实例(127.0.0.1:3080,锁 0.1.0-rc.6)的第二个 viewer:
**UI = dsh 原生 React 组件(vendor 源码构建),布局与浏览器版一致 + 侧边栏定制适配**。
不内嵌 runtime、不另起实例、API key/credentials 不进扩展。

### 0.2 路线 A(源码构建;替代 fetch+boot)

- **vendor/deepseek-harness**(submodule,只读,锁 `47f94385` = 0.1.0-rc.5;上游 master 无 rc.6 源码 rev,
  rc.6 仅 npm 产物,协议差异由 P5-5 冒烟把关)。
- **vendor 内独立 workspace 构建**(嵌套 workspace 不入外层,见 pnpm-workspace.yaml 注释):
  `corepack pnpm install --frozen-lockfile` → `pnpm run build:lib:client`(tsc + tsdown →
  各 client 包 `lib/client.js`)+ `pnpm run build:web`(vite → `apps/web/dist` shell)。
- **装配脚本 `apps/vscode/scripts/build-web-shell.mjs`**(替代 fetch-dsh-ui.mjs):
  1. 拷贝 shell 产物(assets/ 等)→ `apps/vscode/dist/web/dsh-shell/`;
  2. 拷贝各 client 包 `lib/client.js` → `dist/web/dsh-shell/plugins/<id>/client.js`
     (id = 包全名,与上游 `/plugins/<id>/client.js` 路由同构);
  3. 静态组图(镜像上游 ClientModuleRegistry 语义):扫描 client 包 `package.json` 的 `dsh.client`
     (platform=web / immediately / inject)→ `__DSH_BOOT__ = {rev, entries:[{id, url:
     "./plugins/<id>/client.js?rev=<hash>", rev, inject?, immediately?}]}`;与现存 rc.6 抓取图
     (`dist/web/dsh-plugins/boot.js` 内 JSON)做集合核对;
  4. 自产 `index.html`:注入 `__DSH_BOOT__`(首个 head script,`<` 转义,同上游 injectBootManifest)
     + CSP(nonce)+ base href(产物根)+ `__DSH_WEB_URL__`(扩展侧代理地址);
  5. **唯一适配缝**:connection `lib/client.js` 的 `resolveBase` 三元表达式确定性替换为
     `globalThis.__DSH_WEB_URL__ ?? INTERNAL_BASE`;**断言式**——期望文本缺失即构建失败并提示
     更新缝(替代原 regex 双模式替换)。
- **运行时不变**:webview 经扩展侧 HTTP+WS 转发代理(`src/vscode/proxy.ts`,Origin 栅栏绕行,
  d60c16f 结论);会话切换沿用 boot 桥 localStorage 契约(上游 attachPersistence 语义)。
- **排除项(保持)**:changes 改动审查面板(自研)继续;协议层(runtime/wire/session-manager/
  controller)保留。

### 0.3 红线(与 AGENTS.md 一致,不因路线变更放松)

- 不 fork 上游、不改 vendor 内任何源码、不改 packages/core/agent-loop;禁止 Route B(内嵌
  runtime)/Route C(重写 loop)。
- UI 由上游组件 + 上游 connection 层驱动;扩展不自维护 messages[];model-visible ⟺ logged。
- webview 安全:CSP 无 inline script(注入脚本用 nonce,同现状);API key/credentials 不下发
  webview、不进事件渲染。
- 文件写走 WorkspaceEdit/快照回滚;terminal 走 VS Code Terminal API;src/agent/runtime.ts
  只做传输(薄桥)。

### 0.4 版本与协议

- 运行时锁 dsh 0.1.0-rc.6(3080);UI 源码锁 rc.5(`47f94385`,记 docs/versions.md);
  **升级只做专项 + 全量回归**。
- 端点 `POST /api/<method>`(裸 `/api` 404);信封 `{type:"client-request", rpcId, method, payload}`
  → `server-response`;WS 帧 `server-request`(host→client)。详见 docs/http-bridge.md。

## 1. 技术基线

- 环境:node v22.22.3 / pnpm 10.32.1(外层)/ corepack pnpm 11.7.0(vendor,随上游
  packageManager 锁定)/ dsh 0.1.0-rc.6 @ 3080。
- 测试:G0 = typecheck / lint / test / build 全绿;集成测试标 `@live`,无服务可跳过。
- git:只 `git add <具体路径>`;commit 后立即 push;`feat|fix|chore|refactor|docs:` 前缀。
- vendor 构建命令一律在 `vendor/deepseek-harness/` 内执行(corepack pnpm),产物不入外层
  workspace;vendor 内不做任何 git 提交。

## 2. 现状盘点(2026-08-17 实测)

| 项 | 状态 | 说明 |
| --- | --- | --- |
| vendor submodule | ✅ | `47f94385`(0.1.0-rc.5)已初始化;rev 记入 docs/versions.md |
| fetch+boot 产物 | ⚠️ 运行中 | `dist/web/dsh-plugins`(rc.6 抓取);Phase 5 完成后由 dsh-shell 替代,Phase 7 退役 fetch-dsh-ui.mjs |
| Origin 栅栏 | ✅ 已解 | 扩展侧代理(d60c16f);代理本身保留 |
| P0/P1/P2 整改 | ✅ | refactor-requirements.md 执行表;P0-2(Chat Participant)待用户 reload 验证 |
| G0 | ✅ | typecheck 0 / lint 0 warning / 54 tests / build 3 入口(10:07 实测) |
| vendor workspace 安装 | ✅ | 依赖已装(lefthook postinstall 失败为 submodule 限制,无关构建) |

## 3. 阶段计划

### Phase 5:vendor 构建打通(源码构建基座)

- [x] P5-1 submodule 锁定:`vendor/deepseek-harness` @ `47f94385`(0.1.0-rc.5)→ docs/versions.md 记录
- [x] P5-2 vendor workspace 安装:corepack pnpm 11.7.0 install --frozen-lockfile
- [x] P5-3 构建:vendor 内 `pnpm run build:lib:client` + `pnpm run build:web`;验证各 client 包
      `lib/client.js` 与 `apps/web/dist` 产出(**实测:rc.5 源码构建产物与 rc.6 抓取产物字节级一致**)
- [x] P5-4 装配脚本 `build-web-shell.mjs`:拷贝 + 静态组图(与 rc.6 抓取图核对,39 插件零缺失)+
      index.html(静态注入 boot 脚本)+ resolveBase 断言式替换 → 产出 `dist/web/dsh-shell/`
- [ ] P5-5 面板接线:chat-panel.ts 指向 dsh-shell(**接线完成**);headless E2E(`scripts/smoke-shell.mjs`,
      Chrome + Origin 中继)通过:UI 渲染真实会话/工作区/模型/权限,RPC 经代理全通;
      **VS Code 内视觉冒烟待 F5/启动扩展.command 确认**(已自动开一窗口,见 DSH_SMOKE_OPEN 钩子)
- [ ] P5-6 G0 四门 + 提交(脚本 + 接线 + 文档)

### Phase 6:定制适配(侧边栏形态)

- [x] P6-1 定制 boot 图:插件子集(39→28,与 ref-graph-rc6.json 断言一致;含 inject 边裁剪;
      directory-picker-browse/native 一并排除 —— 全量图实测有 directoryFlow 双注册冲突,
      browse 为 rc.5 源码多出包(rc.6 服务端图没有))
- [x] P6-2 侧边栏适配:ui-layout 窄布局原生可用(280px 侧栏 + details 折叠);shell.css 静态样式
      (html/body/#root + [class$=_frame/_sidebarCol/_centerCol/_detailsCol] 透明)替代
      transparentPageChrome DOM 启发式,冒烟断言 body/frame 透明通过
- [x] P6-3 主题对齐:透明走静态 CSS(shell.css,与 shell rev 绑定);组件表面色由上游主题决定
      (与 3080 浏览器一致);VS Code 变量不做运行时注入
- [x] P6-4 扩展壳接线:__DSH_WEB_URL__ 经 buildHtml 注入(代理地址);baseUrl 切换新增
      proxy.setTarget(端口不变,转发重定向,webview 无需重载)
- [x] P6-5 G0 四门绿 + smoke-shell 冒烟通过(28 集:无冲突、透明融合、RPC/WS 全通)

### Phase 7:功能验证与清理

- [ ] P7-1 全功能回归:会话新建/切换/fork、聊天流式、工具调用、审批、subagent 打断、
      goals、jobs、改动审查(自研面板仍工作)
- [ ] P7-2 自研 UI 清理:`web/*`(App.tsx、ChatView、SessionList、InsightsTabs、StatusBar、
      bridge-client、main.tsx)移除;fetch-dsh-ui.mjs 退役(连同 AGENTS.md 对应坑条目);
      bridge.ts 按需保留(changes 面板)
- [ ] P7-3 文档同步:AGENTS.md(UI 红线修订)、README(架构图/当前状态)、docs/gaps.md、
      docs/http-bridge.md(如有变化)
- [ ] P7-4 G0 + 手动测试清单 docs/manual-tests/phase-5.md

### Phase 8:交付门

- [ ] P8-1 G1 审查(Phase 5+6)FAIL→修复
- [ ] P8-2 G2 交付门(全量回归 + §7 Checkbox 更新)
- [ ] P8-3 tag + 发布文档

## 4. 阶段门与验收(沿用)

- G0 提交门:typecheck / lint / test / build 全绿;集成测试 @live 可跳过。
- G1 每阶段独立审查(独立 reviewer);P0/P1 未清即 FAIL。
- G2 交付门:全量 §6.4 类核查 + §7 Checkbox。
- Review 记录:docs/reviews/phase-<n>.md;进度快照更新于本文件顶部。

## 5. 风险登记(§8 更新)

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | rc.5 源码 UI ↔ rc.6 运行时协议漂移 | 部分帧/端点不识别、UI 异常 | P5-5 冒烟全链把关;差异记 docs/versions.md;上游 rc.6 源码出现后升级专项 |
| R2 | vendor workspace 安装/构建重 | 耗时长 | 后台执行;必要时 `--filter` 按需构建 |
| R3 | 上游 boot 机制变更(AppWebEntry/__DSH_BOOT__ 形状) | 装配失效 | 锁 rev;升级专项 + 全量回归 |
| R4 | resolveBase 适配缝随上游漂移 | 连接失败 | 断言式替换(缺文本即构建失败);升级专项 |
| R5 | 静态组图与上游图不一致(漏/多插件) | 功能缺失/重复 | P5-4 与现存 rc.6 抓取图集合核对 |
| R6 | 产物体积/加载性能 | 侧边栏慢 | 复用上游 vendor chunk 策略;按需分包 |

## 6. 执行

按 Phase 5→8 顺序;每完成一步在 TASK.md 打勾;卡住即调整并记录原因。
README「当前状态」在 P7-3 同步。