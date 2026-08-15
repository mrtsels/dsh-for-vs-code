# 协议缺口清单(docs/gaps.md)

> 来源:Phase 3 协议面探测(2026-08-15,scripts/probe-phase3.mjs 实测 dsh 0.1.0-rc.6 @ 3080)。
> 原则(TASK §4.1 P3-8):**不私自扩展 runtime**;探测失败的能力以"文档记录 + UI 降级"处理,并写明期望的上游接口。

## 实测端点可用性一览

| 能力 | 端点/帧 | 实测 | 本扩展实现 |
| --- | --- | --- | --- |
| 会话 CRUD/历史/fork | session.list/create/history/fork/prompt/cancel/rename | ✅ 200 | ✅ 已用 |
| Skills 目录 | skill.list | ✅ 200 | ✅ 洞察面板"技能"tab |
| 子代理 | subagent.list/history/prompt/interrupt | ✅ 200 | ✅ 洞察面板"子代理"tab(仅 continuable 可打断) |
| Goals | goal.create/edit/pause/resume/complete/clear | ✅ 200 | ✅ 洞察面板"Goals"tab(投影帧实时) |
| 后台任务 | session/jobs 推送帧 | ✅(无 unary) | ✅ 洞察面板"任务"tab(推送缓存) |
| Workspace | workspace.list/create/rename/delete/… | ✅ 200 | ⬜ Phase 4 收尾可加 |
| 连接元信息 | host.describe | ✅ 200 | ✅ 状态栏/握手 |
| 审批/提问 | approval/requested → /api/respond;question/requested → /api/respond | ✅ 200 | ✅ 原生通知审批(P2-5) |

## 缺口清单(能力 / 现象 / 降级 / 期望的上游接口)

1. **MCP 服务器状态面**
   - 现象:`mcp.list` 等 MCP 端点一律 404,apiproxy 路由表无任何 `mcp.*` unary;mux 帧亦无 mcp 状态推送
   - 降级:README 说明 MCP 配置由 dsh 实例侧管理(`dsh` 配置/插件),扩展不重复实现 MCP 客户端;UI 不展示
   - 期望:上游提供 `mcp.list`(服务器名/传输/状态)或 `session/projection` 带 `mcp` 投影 key

2. **后台任务取消/停止**
   - 现象:`jobs.list` 404;只有 `session/jobs` 全量推送帧(JobView),无 job 级 cancel/stop RPC
   - 降级:UI 只读展示任务状态;取消由 agent 自身/`session.cancel` 整体取消兜底
   - 期望:上游提供 `job.cancel {sessionId, jobId}` unary(或 `session/jobs` 帧支持请求-响应)

3. **Sandbox 状态面**
   - 现象:无 `sandbox.*` RPC;`session/projection` 通用帧理论上可承载 sandbox 投影,但 rc.6 实测 history projections 仅含 title/sessionStats/goal
   - 降级:README 说明 sandbox 由 Harness 自身 provider 治理,扩展不展示(等投影出现后自动可见——投影帧已是通用通道)
   - 期望:上游在 projection values 增加 `sandbox` key(结构:{name, status, allowedHosts…})

4. **Skill 启用/停用**
   - 现象:`skill.list` 只读;无 skill.enable/disable RPC;注释明确"invocation 是 session.prompt 前导 `/name` 识别"
   - 降级:列表展示(含 modelInvocable 标记);启用与否由 agent 配置(项目级 skills 目录)管理
   - 期望:上游提供 `skill.setEnabled {sessionId, name, enabled}`(或维持现状,列表只读)

5. **credentials 域**
   - 现象:`credentials.describe` 存在但空载荷 bad-request(需特定 payload);凭据属敏感数据
   - 决策:扩展**不下发**任何凭据到 webview(红线);UI 不提供凭据管理
   - 期望:维持现状(凭据由 dsh web 侧管理),无需上游改动

6. **session.history 分页上限**
   - 现象:seedHistory 用 maxMessages=50,历史超长时 UI 只重建尾部 50 条(设计如此,重连后 mux 增量续接)
   - 降级:事件日志以 mux 增量持续累积,重启后尾部重建;完整历史可用 `session.history` 加大 maxMessages
   - 期望:上游实现 `session.history` 的 `since` 参数(v1 明确未实现),使重连可增量拉取

## 记录

- 探测脚本:`apps/vscode/scripts/probe-phase3.mjs`(可重跑;含 goal 单例、fork 等真实副作用)
- 决策记录:任何"缺口的绕过实现"(如自己轮询模拟推送)均被否决——保持薄桥,缺口即文档化
