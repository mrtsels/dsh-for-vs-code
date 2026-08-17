# Phase 5+6 Review(Route A 源码构建)— 2026-08-17

- 范围:0ec02f4..5e02e0c(基线 0ec02f4 TASK.md 重写;10 个功能/修复提交 + 文档)
- 审查方式:主代理出具(独立子代理两轮超时未产出,已中断;证据全部为本轮实测,见下)
- 审查基准:AGENTS.md 红线 + TASK.md §0 路线/§3 Phase 5-6/§4 门

## G0 实测(10:31 重跑)

| 门 | 结果 | 说明 |
| --- | --- | --- |
| typecheck | ✅ EXIT=0 | tsc --noEmit 0 错误 |
| lint | ✅ 0 warning / 0 error | oxlint 53 files |
| test | ✅ 49 passed / 2 skipped | 单测;display.test 随自研 UI 退役(49=54-5) |
| build | ✅ | extension.js + changes.js 两入口 |
| @live | ✅ 4/4 | LIVE_3080=1:proxy HTTP 转发 + WS 101 + runtime-live |
| 装配 | ✅ | build-web-shell.mjs:39→28 裁剪,与 ref-graph-rc6.json 断言通过 |
| 冒烟 | ✅ SMOKE PASS | smoke-shell.mjs:UI 渲染/真实会话数据/RPC/WS 双通道/无 slot 冲突/透明融合/切换桥 |
| VSIX | ✅ | 127 文件 2.13MB;含 dsh-shell + 28 插件 bundle(connection 已打 resolveBase 补丁) |

## 逐类核查

- **A 架构/红线** ✅:vendor 0 个 dirty 文件(不 fork、不改上游);无 spawn/child_process 启动 dsh
  (仅 terminal.ts Pseudoterminal 与 git.ts 只读 execFile,均注释声明);runtime.ts 仍纯传输
- **B UI 路线** ✅:UI = 上游源码构建产物(dsh-shell),扩展不自维护 messages[];
  resolveBase 唯一适配缝为断言式替换(缺文本即构建失败,双变体实测命中);会话切换桥
  (bridge.js)复刻上游 attachPersistence 契约(localStorage dsh.sessions.current),冒烟断言通过
- **C webview 安全** ✅:CSP nonce + cspSource 白名单;无 inline script 泄漏;无 apiKey/secret
  字样进入 webview 路径;shell.css 静态无 DOM 遍历
- **D 装配可复现性** ✅:产物全部来自锁定 rev(47f94385)源码构建,不依赖活实例;
  rc.5 构建产物与 rc.6 npm 产物字节级一致(assets 同名同哈希);boot 图与参考集精确断言
- **E 错误处理** ✅:空 catch 抽查无裸 catch {};装配脚本缺失 bundle/缝失配/图不一致均抛错退出
- **F 工程** ✅:ESM/strict;lint 0;TASK/AGENTS/README/gaps/versions/manual-tests 一致;
  fetch-dsh-ui 已退役,仅构建脚本头部注释保留出处说明

## P1 清单

无(实测全部通过)。审查中发现并已修复的项(记录在案):
1. eb141c8 文件截断事故(chat-panel/tree 被误截)→ df8520e 已恢复完整实现,G0 复绿
2. VSIX 打包被残留 dsh-plugins 目录怪文件名炸掉 → 已删目录 + .vscodeignore 防御(9d933c0)
3. 原生会话树切换在 UI 侧无接收者(旧 debugBridge 退役后) → bridge.js 补齐(af04431)

## P2 建议(不阻塞)

1. [class$="_centerCol"] 等后缀选择器依赖上游 CSS modules 命名约定;升级 rev 后冒烟断言会覆盖
2. smoke-shell.mjs 依赖系统 Chrome(channel: 'chrome');CI 环境需预装或改 playwright bundled
3. ui-layout 窄屏折叠链的视觉细节未人工核验(见 manual-tests §1)
4. docs/probe-phase3-result.json 等 Phase 3 探测产物保留,可归档

## 结论

**PASS**。Route A(源码构建 UI)符合红线与 TASK §0 路线;G0/@live/冒烟/打包全绿。
待办:Phase 7-1 人工功能回归(docs/manual-tests/phase-5.md)后进入 G2。
