# Phase 0 Review — 2026-08-15

- 范围:commits 65b6e99..c448171(单提交 c448171,14 个文件,383+/13-)
- G0 gate:typecheck ✅ / lint ⚠️ / test ✅ / build ✅ / package ✅(输出摘要见下)
- 独立审查:reviewer hermes-subagent-reviewer;审查文件 14 个
- 发现:P0 × 0 / P1 × 3 / P2 × 9(逐条见下)
- 结论:**FAIL**(P1 × 3 未清;每条均为一两行修复,修复后请回发 reviewer 复检)

## G0 gate 实际重跑摘要(2026-08-15,本机 node v22.22.3 / pnpm 10.32.1)

```
pnpm typecheck  → tsc --noEmit:EXIT=0,0 错误                    ✅
pnpm lint       → oxlint 7 files / 101 rules:Found 1 warning and 0 errors  ⚠️
                  (1 warning 来自 untracked 的 apps/vscode/scripts/probe.mjs:
                   no-unused-vars 'log' declared but never used;
                   已提交的 Phase 0 范围内 lint = 0 警告)          ✅(提交范围)
pnpm test       → vitest 3.2.7:test/smoke.test.ts 1/1 passed     ✅
pnpm build      → dist/extension.js + dist/web/index.js(254.2kb)+ map,双入口成功 ✅
pnpm package    → vsce:9 files / 141.9KB VSIX,media+dist 全在    ✅
                  WARNING:LICENSE 未找到(见 P2-3)
```

## 审查清单逐类核查

- **A 架构** ✅ A1 无 packages/core / agent-loop 依赖(devDeps 纯工具链);A2 无自研 agent loop;A3 runtime.ts 不存在(Phase 1,符合);A4 docs/versions.md 已记录,但**精确锁定失效见 P1-2**;A5 无 Route C 痕迹
- **C VS Code 集成** ⚠️ C3 两个命令 + TreeDataProvider 均入 subscriptions ✅,deactivate 注释合理 ✅;panel.onDidDispose 的 disposable 未入 subscriptions(P2-1);C4 contributes(open/ask 命令、容器 deepseekHarness、view deepseekHarness.chat、icon media/deepseek.svg)与代码注册一一对应 ✅;C5 dist+media 均在 VSIX 内、localResourceRoots=dist/web ✅,但 webview 实际加载的内联 HTML 脚本被 CSP 拦截(P1-1),dist/web/index.html 为死文件(P1-3)
- **D webview 安全** ⚠️ D1 无 inline script、script-src 仅 nonce、无 remote origin、default-src 'none' ✅;**nonce 生成两次导致 CSP 失配,面板必空白(P1-1)**;style-src 'unsafe-inline'(P2-2);D2~D5 Phase 1 才涉及,当前无 postMessage/无 credentials 下发 ✅
- **E 类型与错误处理** ✅ E1 strict + noUncheckedIndexedAccess + noImplicitOverride,全范围 grep 无 any/@ts-ignore;E2 build.mjs main().catch(exit 1)✅,命令 handler 为同步体风险低
- **G 工程规范** ⚠️ G1 ESM everywhere(extension.js 输出为 ESM,NodeNext 的 .js 后缀 import 正确)✅;G2 命名一致 ✅;G3 关键路径单测仅覆盖 nonce(),**webviewHtml/CSP 路径无测试**(P1-1 即漏网于此,P2-10);G4 commit 只含 14 个预期文件、无 dist/.vscode/vsix 混入 ✅;**pnpm-lock.yaml 漏提交(P1-2)**;.serena/ 与 probe.mjs 未跟踪(P2-6/P2-7);G5 提交范围无调试残留 ✅(console 仅 build.mjs,已白名单)
- **H 回归与兼容** ⚠️ H1 versions.md 带版本+日期 ✅;H2 VSIX 打包 media+dist 齐全 ✅,但含死文件 index.html 与 332KB sourcemap(P1-3/P2-4);H3 激活冒烟通过(背景已验证),**面板内容不可见(P1-1)**;launch.json 本地才有,fresh clone 无法 F5(P2-8)

## 发现清单

### P0(必须修复,阻塞交付)

无。

### P1(必须修复)

1. **apps/vscode/src/extension.ts:61,66 | webview 必空白:CSP nonce 与 script nonce 由两次独立 `nonce()` 调用生成,值必然不同,`script-src 'nonce-X'` 拦截 nonce=Y 的唯一脚本,React 占位永不渲染**。本机已复现(两次调用输出不同 nonce,MATCH:NO)。背景冒烟只验证了"激活成功",未验证面板内容,故未被发现。建议:`const n = nonce();` 一次生成,两处复用;或改读 dist/web/index.html 单点替换(见 P1-3)。
2. **pnpm-lock.yaml(仓库根,untracked 未提交)| 构建不可复现,违反 TASK §0.5.8 版本锁定**。docs/versions.md:14 明写"精确版见 pnpm-lock.yaml",但 lockfile 不在 git 中(未被 ignore,只是漏 add);fresh clone `pnpm install` 按 range 重新解析(typescript ^5.7.0、esbuild ^0.25.0 等会漂移)。建议:`git add pnpm-lock.yaml`;CI 用 `pnpm install --frozen-lockfile`。
3. **apps/vscode/scripts/build.mjs:43-56 + src/util/nonce.ts:1 | dist/web/index.html 骨架是死代码,__NONCE__ 占位无人替换,两处 CSP 重复定义易漂移**。extension.ts 内联拼 HTML,从不读该文件;nonce.ts 注释"注入 index.html 的 __NONCE__ 占位"与实现不符;死文件仍随 VSIX 发布。Phase 1 P1-6 已规划"加载 dist/web/index.html",建议现在就二选一:(a) webviewHtml 改为读取骨架并做单点 nonce 替换(单一事实源,顺带修复 P1-1);(b) 删除骨架生成逻辑并修正 nonce.ts 注释。

### P2(记录,可延后)

1. apps/vscode/src/extension.ts:46 | onDidDispose 返回的 Disposable 未加入 context.subscriptions | TASK §0.5.2"注册即 effect"要求每个订阅有 disposer,且 Phase 1 P1-6 要求 onDidDispose 全清理——现在就立好模板:`subscriptions.push(panel.onDidDispose(...))`
2. apps/vscode/src/extension.ts:61 | `style-src 'unsafe-inline'` 为 React 内联 style prop 所需 | 样式外置为 CSS 文件后收紧为 nonce/hash
3. apps/vscode/(包目录) | 无 LICENSE(vsce WARNING 已确认;根 LICENSE 不在包内)、无 README.md | 复制 LICENSE 进 apps/vscode;补最小 README(市场发布必需)
4. apps/vscode/dist/web/index.js.map 等 | sourcemap 随 VSIX 发布(index.js.map 332KB > bundle 254KB;extension.js.map 4.5KB) | .vscodeignore 排除 `**/*.map`(或 files 收窄)
5. apps/vscode/.oxlintrc.json:16 | `no-undef: off` 全局关闭,削弱 lint 效力 | 改为按环境声明 globals(node/browser)而非整体关闭
6. apps/vscode/scripts/probe.mjs(untracked) | Phase 1 WIP 文件使本机 `pnpm lint` 出现 1 warning(no-unused-vars 'log'),G0 在脏工作区不绿 | 提交前修掉或移至单独目录;Phase 1 提交时 lint 必须 0 警告
7. .serena/(untracked) | 本地 agent 工具目录未忽略,存在被误 add 风险 | 加入 .gitignore
8. .vscode/launch.json + tasks.json 被 gitignore | fresh clone 无法 F5,与 H3"F5 干净启动"及 TASK P0-6 的可复现性矛盾 | 提交无绝对路径的便携版 launch.json,或在 README/AGENTS 明示"本地自备"
9. TASK.md:101,22 | `pnpm --filter @deepseek-ai/dsh-for-vscode install` 与 package.json 实际 name `dsh-for-vscode` 不符;§0.2 日期"2025-08-15"应为 2026-08-15 | 文档订正

## 遗留问题跟踪

- P1-1/P1-3 建议合并修复(读骨架 + 单点 nonce),修复后重跑 G0 并回发 reviewer 复检
- P2 清单由主 agent 记入问题清单,随 Phase 1 跟踪(P2-1 应在 P1-6 前落实)

## 修复核验记录(2026-08-15,HEAD d47b94c)

> 审查基于 c448171;下列核验对照当前 HEAD(Phase 1~4 + 各轮 G1/G2 修复均已合入)。

### P1 核验(3/3 已修复 ✅)

1. **P1-1 ✅** — panel.ts:85 单次 `const n = nonce()`,`:90 .replaceAll('__NONCE__', n)` 单点替换;changes-panel.ts:79 同模式。两处 CSP 不再失配,面板可渲染。
2. **P1-2 ✅** — pnpm-lock.yaml 已提交(292e91c),fresh clone 可复现。
3. **P1-3 ✅** — 采用建议方案 (a):panel.ts:26-27 读取 `dist/web/index.html` 骨架,`:89-91` 做 __NONCE__ + src 单点替换;extension.ts 不再内联拼 HTML;nonce.ts 注释与实现一致。

### P2 核验(8/9 已修复 ✅,1 项遗留)

| # | 项 | 状态 |
|---|---|---|
| 1 | onDidDispose 入 disposer | ✅ panel.ts:48 / changes-panel.ts:49(DisposableSet 内,联动 dispose) |
| 2 | style-src 'unsafe-inline' | ⚠️ 遗留:React inline style prop 所需;已记 gaps/final.md 跟踪 |
| 3 | 包内 LICENSE/README | ✅ apps/vscode/LICENSE 已加(292e91c);VSIX 含 readme |
| 4 | sourcemap 随 VSIX | ✅ .vscodeignore `**/*.map` |
| 5 | no-undef off | ✅ 已从 .oxlintrc 移除 |
| 6 | probe.mjs lint warning | ✅ 脚本区白名单,当前 lint 0 warning |
| 7 | .serena/ 未忽略 | ✅ .gitignore 已加 |
| 8 | launch/tasks 便携化 | ✅ 292e91c 提交便携版(.gitignore 白名单例外) |
| 9 | TASK.md 笔误 | ✅ 已订正(包名无 scope、2026-08-15) |

### 复检结论

**Phase 0 转 PASS**(P1×3 全清,P2 仅 unsafe-inline 一项遗留并已登记跟踪;该遗留不影响交付门,已含在 final.md P2 清单 #12)。
