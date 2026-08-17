# 协议缺口清单(docs/gaps.md)

> 来源:Phase 3 协议面探测(2026-08-15,`scripts/probe-phase3.mjs` + follow-up 实测 dsh 0.1.0-rc.6 @ 3080)。
> 原则(TASK §4.1 P3-8):**不私自扩展 runtime**;探测失败的能力以"文档记录 + UI 降级"处理,并写明期望的上游接口。
> 原始数据:`docs/probe-phase3-result.json`(30 条 unary 逐条 + 全部帧样本)。
## Route A 源码构建实测发现(2026-08-17,P5-4/5 headless E2E)

- **rc.5 源码构建产物与 rc.6 npm 产物(3080 dist)字节级一致**(assets 哈希同名),协议漂移风险实测消除。
- **mux 通道存在二进制帧**,上游 rc.5/rc.6 客户端(connection readWebSocket)均丢弃
  (`typeof event.data !== 'string'` → drop);与浏览器版 3080 行为一致,非本扩展回归;
  UI 正常(会话/流式依赖的帧为文本帧)。若上游某日改发关键二进制帧,症状=事件缺失,排查入口在此。
- **`/plugins/events`(HMR dev SSE 通道)在无 dev server 时 404**:dsh-client-hmr 常驻图内,404 无害且
  与旧路线一致;Phase 6 裁剪时评估是否移除 hmr。
- **全量插件图(39)有 slot 双注册冲突**:`conversation.hero.workspace.directoryFlow`(ui-workspace ×
  ui-directory-picker-browse/native,priority 0)。上游浏览器同图同错(非致命,pageerror 级);
  Phase 6 裁剪排除 directory-picker-* 后消失。


## 实测端点可用性一览

| 能力 | 端点/帧 | 实测 | 本扩展实现 |
| --- | --- | --- | --- |
| 会话 CRUD/历史/fork | session.list/create/history/fork/prompt/cancel/rename | ✅ 200 | ✅ 已用 |
| Skills 目录 | skill.list {sessionId} | ✅ 200(ego-browser,modelInvocable=true) | ✅ 洞察面板"技能"tab |