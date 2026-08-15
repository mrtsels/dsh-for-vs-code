# Phase 2 手动自测记录(P2-10)

> 状态说明:**机器已验证** = 单测/集成测试/CLI 冒烟覆盖;**待 F5** = 需在 VS Code 按 F5 人工执行。
> 环境:dsh 0.1.0-rc.6 @ 127.0.0.1:3080,node v22.22.3。

## 场景清单(P2-10 六条 + 补充)

| # | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| 1 | 选中代码 → Ask "解释选中内容" | 回答确实包含选中代码语义(上下文前缀注入) | **待 F5**(formatEditorContext 单测通过;真实注入链路待人工) |
| 2 | 人为制造 TS 报错 → Ask 相关问题 | agent 回答引用该报错(活动文件诊断注入) | **待 F5**(collectDiagnostics 实现;onDidChangeDiagnostics 徽标已接) |
| 3 | Ask "总结我的未提交改动" | 输出与 `git status` 一致(git 摘要注入) | **机器已验证**(parseStatusPorcelain/parseNumstat 单测;真实问答待 F5) |
| 4 | patch 审批流:Accept / Reject / 编辑后应用 | apply_patch 工具请求 → 原生通知 → 允许一次/拒绝 → approval/resolved | **待 F5**(approval 帧 → /api/respond 链路已实现,需工具触发审批的场景验证) |
| 5 | 面板"终端"输入 `pnpm test` | 输出在 UI 可见(Pseudoterminal 捕获) | **待 F5**(CapturingPty 实现;创建失败降级集成终端) |
| 6 | 回滚后文件内容与快照一致 | 改动面板 → 回滚 → 文件恢复 before 内容 | **待 F5**(rollback 走 WorkspaceEdit;diffLines 单测通过) |
| 7 | DeepSeek Harness: Review Changes 命令 | 打开改动审查面板 | **待 F5**(命令已注册,面板已实现) |
| 8 | agent 连续改两个文件 → 逐个 diff 审查、可单独回滚 | 面板列出两个文件,各自独立回滚 | **待 F5** |

## 备注

- 单元测试覆盖:patch 解析(增删改/上下文/重叠冲突/多 hunk)、context 格式化、git 输出解析 → 35/35 全绿;
- approval 审批:P2-5 链路 = mux `approval/requested`(带 rpcId)→ VS Code 原生通知(允许一次/拒绝)→ `POST /api/respond`(client-response,outcome: allowed-once/rejected);
- Pseudoterminal:命令经 pty 内 spawn shell 执行,stdout/stderr 实时回传 UI;失败降级普通集成终端;
- 已知限制(T-1 固有边界,最终形态):agent 在 dsh 实例内写盘不经 VS Code,快照 diff + 回滚是审批的兜底(见 TASK §8 R3)。
