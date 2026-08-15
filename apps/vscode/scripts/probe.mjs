/**
 * P1-1 协议探测脚本(dsh web @ 127.0.0.1:3080,无第三方依赖,node >= 22)
 *
 * 用途:验证 wire contract(TASK §0.3)、探测方法面、采集"黄金事件时间线"
 * (user/message → step/start → assistant/chunk* → tool/call → tool/result →
 *  assistant/message → step/end),作为 UI 渲染与集成测试的样本。
 *
 * 用法:node scripts/probe.mjs [--prompt "hello"] [--no-ws] [--no-prompt]
 * 结果写入 docs/http-bridge.md(需 --write-doc)。
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

/** 原始 TCP 发一个 HTTP 请求,返回状态行(测信任栅栏用) */
function rawStatusLine(requestText) {
  return new Promise((resolveP) => {
    const s = net.connect(3080, '127.0.0.1', () => s.write(requestText));
    let buf = '';
    s.on('data', (d) => (buf += d));
    s.on('close', () => resolveP(buf.split('\r\n')[0] ?? '(no response)'));
    s.on('error', () => resolveP('socket-error'));
  });
}

const BASE = process.env.DSH_BASE ?? 'http://127.0.0.1:3080';
const args = process.argv.slice(2);
const PROMPT = args.find((a) => a.startsWith('--prompt='))?.slice(9) ?? 'hi';
const DO_WS = !args.includes('--no-ws');
const DO_PROMPT = !args.includes('--no-prompt');
const WRITE_DOC = args.includes('--write-doc');

const rpcId = () => crypto.randomUUID();

/** POST /api/<method> 信封调用 */
async function rpc(method, payload = {}) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: rpcId(), method, payload }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** 打开一个 WS downlink,收集 frames */
function collect(path, ms = 2500) {
  return new Promise((resolveP) => {
    const ws = new WebSocket(`ws://127.0.0.1:3080${path}`);
    const frames = [];
    const timer = setTimeout(() => { ws.close(); resolveP(frames); }, ms);
    ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
    ws.onerror = () => { clearTimeout(timer); resolveP(frames); };
  });
}

const out = { base: BASE, dsh: process.env.DSH_VERSION ?? 'unknown', at: new Date().toISOString() };

async function main() {
  // 1) SPA 与路由行为
  const spa = await fetch(`${BASE}/`);
  out.spa = { status: spa.status };
  const getMux = await fetch(`${BASE}/api/events.mux`);
  out.getMuxStatus = getMux.status; // 期望 426
  // 信任栅栏必须用原始 socket 测:Fetch 规范禁止客户端设置 Host 头(浏览器安全)
  out.trustFenceBadHost = await rawStatusLine(`POST /api/host.describe HTTP/1.1\r\nHost: evil.example:3080\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(JSON.stringify({ type: 'client-request', rpcId: rpcId(), method: 'host.describe', payload: {} }))}\r\nConnection: close\r\n\r\n${JSON.stringify({ type: 'client-request', rpcId: rpcId(), method: 'host.describe', payload: {} })}`); // 期望 403

  // 2) 只读方法面
  out.hostDescribe = (await rpc('host.describe')).body;
  out.sessionList = (await rpc('session.list')).body;
  out.agentPresets = (await rpc('agentPresets.list')).body;
  out.settingsNamespaces = (await rpc('settings.namespaces', {})).body;

  // 3) WS downlinks(基线帧)
  if (DO_WS) {
    out.muxBaseline = await collect('/api/events.mux', 2500);
    out.hostBaseline = await collect('/api/events.host', 2500);
  }

  // 4) 建会话 → 提问 → 采集黄金时间线
  let sessionId;
  const created = (await rpc('session.create', {})).body;
  sessionId = created?.result?.ok ? created.result.value.sessionId : undefined;
  out.createdSession = created;
  if (sessionId && DO_PROMPT) {
    const muxFrames = [];
    const ws = new WebSocket(`ws://127.0.0.1:3080/api/events.mux`);
    await new Promise((resolveOpen) => { ws.onopen = resolveOpen; });
    ws.onmessage = (e) => {
      const f = JSON.parse(String(e.data));
      if (f.method === 'session/event' && f.payload?.sessionId === sessionId) muxFrames.push(f.payload);
    };
    await new Promise((r) => setTimeout(r, 300)); // 等 subscribed 帧
    out.promptAccepted = (await rpc('session.prompt', {
      sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT }],
    })).body;
    await new Promise((r) => setTimeout(r, 12000)); // 等一个完整 turn
    ws.close();
    out.goldenTimeline = muxFrames;
    out.historyAfterTurn = (await rpc('session.history', { sessionId, maxMessages: 3 })).body;
  }

  if (WRITE_DOC) {
    const doc = `# http-bridge.md — dsh web wire contract(探测记录)\n\n> 生成于 ${out.at},dsh ${out.dsh},base ${out.base}。升级 dsh 后必须重跑 \`node scripts/probe.mjs --write-doc\` 回归(R1)。\n\n\`\`\`json\n${JSON.stringify(slimOut(out), null, 2)}\n\`\`\`\n`;
    const dest = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/http-bridge.md');
    writeFileSync(dest, doc);
    console.log(`\n[probe] 文档已写入 ${dest}`);
  }
}

/** 精简探测记录(原始 dump 含大量 projections,仓库文档不需要) */
function slimOut(o) {
  const s = { ...o };
  s.hostDescribe = { result: o.hostDescribe?.result };
  if (Array.isArray(s.sessionList?.result?.value?.items)) {
    s.sessionList.result.value.items = s.sessionList.result.value.items.map((i) => ({
      sessionId: i.sessionId, updatedAt: i.updatedAt, running: i.running, blank: i.blank,
      cwd: i.cwd, agentPreset: i.agentPreset, title: i.projections?.values?.title ?? null,
    }));
  }
  if (Array.isArray(s.agentPresets?.result?.value?.presets)) {
    s.agentPresets.result.value.presets = s.agentPresets.result.value.presets.map((p) => ({ id: p.id, isDefault: p.isDefault }));
  }
  if (typeof s.settingsNamespaces?.result?.value === 'object') {
    s.settingsNamespaces.result.value = Object.keys(s.settingsNamespaces.result.value);
  }
  if (Array.isArray(s.muxBaseline)) s.muxBaseline = s.muxBaseline.map((f) => ({ method: f.method, payloadType: f.payload?.type }));
  if (Array.isArray(s.hostBaseline)) s.hostBaseline = s.hostBaseline.map((f) => ({ method: f.method, payloadType: f.payload?.type }));
  if (Array.isArray(s.goldenTimeline)) {
    s.goldenTimeline = s.goldenTimeline.map((f) => {
      const ev = f.event ?? {};
      const d = ev.data ?? {};
      return {
        type: ev.type, seq: ev.seq,
        chunk: d.chunk ? { type: d.chunk.type, blockType: d.chunk.blockType, textLen: d.chunk.text?.length ?? 0 } : undefined,
        contentLen: d.content ? JSON.stringify(d.content).length : undefined,
        toolName: d.tool?.name,
      };
    });
  }
  if (s.historyAfterTurn?.result?.ok && Array.isArray(s.historyAfterTurn.result.value.events)) {
    s.historyAfterTurn.result.value.events = s.historyAfterTurn.result.value.events.map((e) => ({ type: e.event?.type, seq: e.event?.seq }));
  }
  return s;
}

main().catch((e) => { console.error('[probe] FAILED:', e); process.exit(1); });
