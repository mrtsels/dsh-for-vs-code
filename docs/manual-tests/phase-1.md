# Phase 1 手动自测记录(P1-14)

> 状态说明:**机器已验证** = 单测/集成测试/CLI 冒烟覆盖;**待 F5** = 需在 VS Code 按 F5 人工执行。
> 环境:dsh 0.1.0-rc.6 @ 127.0.0.1:3080,node v22.22.3,VS Code 1.95+。

## 场景清单

| # | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| 1 | F5 → Ask "列出当前目录的文件" → 流式回答 + 工具调用卡片 | 回答流式出现;如触发工具则显示卡片 | **待 F5**(协议链路已由 @live 测试 + 黄金时间线验证) |
| 2 | 运行中按停止 → 状态回 idle,无泄漏 | stop 按钮生效,状态栏回"就绪" | **待 F5**(session.cancel 协议已验证 accepted:true) |
| 3 | 开两个会话 → 切换 → 各自历史正确(无串台) | 会话切换后事件不混 | **待 F5**(session-manager 按 sessionId 分桶,单测覆盖) |
| 4 | 杀掉 dsh web → UI disconnected → 重启 → 自动重连 | 状态栏变"未连接/重连中",重启后自动恢复 | **机器已验证**(runtime 退避重连逻辑);完整 UI 链路 **待 F5** |
| 5 | Ask "创建 hello.txt 并写入内容" → 文件生成 + UI diff + 回滚 | 快照 watcher 捕获改动,diff 视图可见,回滚可用 | **待 F5**(diffLines 单测通过;watcher 依赖工作区事件) |
| 6 | Ask "运行 pwd" → 集成终端执行 | dsh 终端出现并输出 | **待 F5**(terminal.ts 已实现,输出不回传是已知限制) |
| 7 | 非法/损坏消息注入 bridge → 显式报错而非崩溃 | 面板弹警告,扩展不崩 | **机器已验证**(validateWebviewRequest 单测) |
| 8 | cwd 一致性检测(P1-15):在 dsh-for-vs-code 之外开文件夹 F5 | 状态栏警告 "cwd ≠ 工作区";一致时不显示 | **待 F5** |

## 备注

- 场景 1/2/3 的协议面(建会话、prompt 接受、事件流、cancel)已由 `test/runtime-live.test.ts` 与 `scripts/probe.mjs`(黄金时间线)实测;
- 场景 4 的自动重连:runtime 每代失效后按 500ms×2^n(上限 10s)+ 抖动重连,状态经 onStatus 广播;
- 已知限制(T-1):agent 跑在 dsh 实例进程内,其写文件不经过 VS Code,快照 diff 是最终形态(见 TASK §8 R3)。
