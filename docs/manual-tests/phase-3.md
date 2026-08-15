# Phase 3 手动自测记录(P3-9)

> 状态说明:**机器已验证** = 单测/探测/CLI 冒烟覆盖;**待 F5** = 需在 VS Code 按 F5 人工执行。
> 环境:dsh 0.1.0-rc.6 @ 127.0.0.1:3080(运行中)。

## 场景清单(P3-9 每条能力一条)

| # | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| 1 | 洞察面板"技能"tab | 列出该会话可用的 skill(name/描述/modelInvocable 标记) | **机器已验证**(skill.list 200 + 单测);UI 待 F5 |
| 2 | "任务"tab | 显示 session/jobs 推送的任务(id/kind/状态/详情) | **机器已验证**(推送帧缓存 + 单测);UI 待 F5 |
| 3 | "子代理"tab | 列出子代理;continuable 的有"打断"按钮 | **机器已验证**(subagent.list 200);UI 待 F5 |
| 4 | "Goals"tab:创建 goal | 输入目标 → 创建 → 显示 phase/rounds;再创建被拒(单例) | **机器已验证**(goal.create/clear 200 + 单例错误实测);UI 待 F5 |
| 5 | "Goals"tab:暂停/恢复/完成/清除 | 按钮生效,CAS ref 正确 | **机器已验证**(goal.clear 200);全按钮 UI 待 F5 |
| 6 | 会话列表 ⧉ 按钮 | fork 出新会话并自动打开 | **机器已验证**(session.fork 200);UI 待 F5 |
| 7 | 重启 VS Code | 上次活跃会话自动恢复(globalState 引用 + 连接后 re-seed) | **待 F5** |
| 8 | 命令 "切换实例地址" | 输入新地址 → 配置更新 → 自动重连(状态栏/徽标反映) | **待 F5**(rebase 已实现,runtime 单测覆盖重连逻辑) |
| 9 | MCP/Jobs 取消/Sandbox 缺口 | 不在 UI 出现;README/gaps.md 有说明 | ✅ 文档化(见 docs/gaps.md) |

## 备注

- 协议探测:scripts/probe-phase3.mjs 实测全部端点(可重跑;注意 goal 单例副作用);
- goals 数据流:history projections 块(基线)+ session/projection 帧(higher-seq-wins 增量);
- jobs 数据流:session/jobs 全量推送帧,无 unary、无 cancel(gaps #2);
- 切换实例地址:命令写配置 → onDidChangeConfiguration 统一 rebase(单一路径,防重复重连);
- 会话持久化:globalState 只存会话引用(会话本体在实例侧),重启后连接成功即 re-seed。
