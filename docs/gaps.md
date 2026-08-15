# 协议缺口清单(docs/gaps.md)

> 来源:Phase 3 协议面探测(2026-08-15,`scripts/probe-phase3.mjs` + follow-up 实测 dsh 0.1.0-rc.6 @ 3080)。
> 原则(TASK §4.1 P3-8):**不私自扩展 runtime**;探测失败的能力以"文档记录 + UI 降级"处理,并写明期望的上游接口。
> 原始数据:`docs/probe-phase3-result.json`(30 条 unary 逐条 + 全部帧样本)。

## 实测端点可用性一览

| 能力 | 端点/帧 | 实测 | 本扩展实现 |
| --- | --- | --- | --- |
| 会话 CRUD/历史/fork | session.list/create/history/fork/prompt/cancel/rename | ✅ 200 | ✅ 已用 |
| Skills 目录 | skill.list {sessionId} | ✅ 200(ego-browser,modelInvocable=true) | ✅ 洞察面板"技能"tab |
| 子代理 | subagent.list/history/prompt/interrupt | ✅ 200(list);interrupt 待真实子 agent 补实测 | ✅ 洞察面板"子代理"tab |
| Goals | goal.create/edit/pause/resume/complete/clear | ✅ 200 全链(见 CAS 语义) | ✅ 洞察面板"Goals"tab(投影帧实时) |
| 后台任务 | session/jobs 推送帧 | ✅(无 unary;running→completed 各推一次) | ✅ 洞察面板"任务"tab(推送缓存) |
| Workspace | workspace.list/archiveSession/… | ✅ 200 | ⬜ Phase 4 收尾可加 |
| 连接元信息 | host.describe | ✅ 200 | ✅ 状态栏/握手 |
| 审批/提问 | approval/requested → /api/respond;question/requested → /api/respond | ✅ 200 | ✅ 原生通知审批(P2-5) |
| 凭据查询 | credentials.describe {refs:[]} | ✅ 200(空 refs → {credentials:{}}) | UI 不展示(红线:凭据不下发) |

## goal CAS 语义(实测,必须遵守)

- ref = `{id, revision}`;**每次 edit/pause/resume/complete 都 revision+1**,响应返回最新 ref;
- 用旧 ref 调 mutation → `internal:GoalError: stale goal ref "<id>" revision N; current is "<id>" revision M`——**错误消息带当前 revision,可解析后自适应重试**;
- **UI 必须链式取每次响应的 ref,不可复用旧值**;
- `goal.clear` 也必带 ref(`{sessionId, ref}` → `{cleared:true}`);缺 ref → bad-request;
- goal 创建后**驱动轮是真实 agent 轮**(实测:自主读工作区、自行 complete goal),probe/测试必须用 scratch 会话并清理。

## 缺口清单(能力 / 现象 / 降级 / 期望的上游接口)

1. **MCP 服务器状态面(P3-1)**
   - 现象:`mcp.list` 等 MCP 端点一律 404,apiproxy 路由表无任何 `mcp.*` unary;mux/host 帧亦无 mcp 状态推送;MCP 是配置型插件(cordis.yml 每服务器一实例),工具注册进 ctx.tools
   - 可用的:MCP 工具以 `mcp__<serverName>__<rawName>` 出现在 `tool/call` 事件(命名契约见 rc.6 dsh-mcp-client)
   - 降级:README 说明 MCP 配置由 dsh 实例侧管理,扩展不重复实现 MCP 客户端;工具卡按 `mcp__` 前缀天然标注
   - 期望:上游提供 `mcp.servers`(服务器名/传输/状态)或 `session/projection` 带 `mcp` 投影 key

2. **后台任务取消/停止(P3-4)**
   - 现象:`jobs.list` 404;只有 `session/jobs` 全量推送帧(`{type:"session/jobs", sessionId, jobs:[{id,kind,label,status,detail?,startedAt,finishedAt?}]}`,**收到即全量替换**);无 job 级 cancel RPC;job 输出无独立接口(靠 job_output 工具回流事件流)
   - 降级:UI 只读展示任务状态;断线重连后以重连后首帧为准(无历史);取消由 agent 自身/`session.cancel` 整体取消兜底
   - 期望:上游提供 `job.cancel {sessionId, jobId}` 与 `job.output {jobId, afterByte}`(重连恢复需要)

3. **Sandbox 状态面(P3-6)**
   - 现象:无 `sandbox.*` RPC(404);状态走事件与投影:
     - 实测 `session/projection` 帧 key=`permissions`:`{options:[{value:"read-only"|"workspace-write"|"danger-full-access",name}], currentValue}`(权威快照)
     - 实测会话事件:`permission/preset {preset}`(seq0 即推)、`sandbox/mode`、`approval/policy`
   - 降级:UI 状态条显示 currentValue(来源=projection+事件);不做权限修改 UI(沙箱归属 Harness 侧)
   - 期望:上游提供 `sandbox.describe {sessionId}` unary(与 projection 同源即可)

4. **Skill 启用/停用(P3-2)**
   - 现象:`skill.list` 只读;无 skill.enable/disable RPC;invocation 是 session.prompt 前导 `/name` 识别
   - 降级:列表展示(含 modelInvocable 标记);启用与否由 agent 配置(项目级 skills 目录)管理
   - 期望:上游提供 `skill.setEnabled {sessionId, name, enabled}`(或维持现状,列表只读)

5. **Session 持久化/归档帧缺口(P3-5,实现侧行动项)**
   - 现象:会话持久化在 dsh 侧(`~/.dsh/sessions/`),`session.list`+`session.history` 可重建;`workspace.archiveSession` ✅;但 **host 帧 `host/archived-sessions-changed {archivedSessionIds[]}` 实测存在,wire.ts 的 HostFrame union 未收录** → 归档状态变化扩展无感知
   - 降级:补 wire.ts 类型 + 订阅刷新列表(小改,归属 P3-5)
   - 期望:维持现状(补类型即可)

6. **session.history 分页上限**
   - 现象:seedHistory 用 maxMessages=50,历史超长时 UI 只重建尾部 50 条(设计如此,重连后 mux 增量续接)
   - 降级:事件日志以 mux 增量持续累积,重启后尾部重建;完整历史可用 `session.history` 加大 maxMessages
   - 期望:上游实现 `session.history` 的 `since` 参数(v1 明确未实现),使重连可增量拉取

7. **fork 前置条件(P3-5,协议行为)**
   - 现象:`session.fork` 需要会话**至少一个 completed turn**,否则 `fork-unavailable:"…has no completed turn to fork from"`(实测);atSeq 锚定已完成 turn 的切口
   - 降级:UI 对 blank/运行中会话禁用 fork 按钮,提示"需要至少一个已完成回合"
   - 期望:维持现状(行为已明确)

8. **子代理 interrupt 待实测(P3-3/P3-9)**
   - 现象:`subagent.interrupt {parentSessionId, childSessionId, mode:"continuable"}` → `{accepted:true}` 仅 bundle 确认,实测时无在飞子 agent(entries=[])
   - 可用的:子 agent 活动事件 `subagent/descriptor`、`tool-workflow/agent-start|end`、`tool-workflow/run-start|end`;后台子 agent 同时产生 session/jobs 帧
   - 降级:时间线分组用上述事件重建(纯事件驱动,符合 §0.5.3);interrupt live 验证纳入 P3-9 自测
   - 期望:无硬缺口

## 附带实测结论(非缺口,记录)

- **mux 全量广播**:所有 attached 会话的 `session/event` 都在同一条流(90s 窗口 550~666 条;另一会话流式输出峰值窗口 13255 帧)。扩展按 sessionId 分桶正确;长会话需节流/上限(R7)。
- **host 帧面**:`host/session-added {sessionId,blank,cwd,agentPreset}`、`host/session-status {sessionId,running}`、`host/archived-sessions-changed`(实测);wire.ts 已有 added/removed/status 等,缺 archived-sessions-changed(见缺口 5)。
- **credentials.describe 载荷**:必填 `refs` 数组(≤64),`{refs:[]}` → `{credentials:{}}`(空载荷 bad-request);凭据属敏感数据,扩展不下发 webview(红线)。
- **prompt 排队**:`session.prompt` mode="queue" 排在当前 turn 后;有 `session/queue` 帧(含 placement/items)告知 UI 排队状态。

## 记录

- 探测脚本:`apps/vscode/scripts/probe-phase3.mjs`(可重跑;含 goal 全生命周期、fork、真实 background job 捕获等副作用,须用 scratch 会话)
- 决策记录:任何"缺口的绕过实现"(如自己轮询模拟推送)均被否决——保持薄桥,缺口即文档化
