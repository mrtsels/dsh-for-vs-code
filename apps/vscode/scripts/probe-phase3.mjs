// probe-phase3.mjs — Phase 3 协议面实测(dsh 0.1.0-rc.6,无第三方依赖,node >= 22)
//
// 用途:P3-1~P3-7 涉及的 unary 端点逐条实测 + 双 WS downlink 帧采集,
//       产出 P3-8 docs/gaps.md 与 docs/http-bridge.md Phase 3 章节的依据。
//
// 用法:
//   node probe-phase3.mjs [baseUrl] [--no-ws] [--no-goal] [--no-prompt]
//     --no-goal   跳过 goal 生命周期与 fork/archive 副作用测试
//     --no-prompt 跳过真实 background job 捕获(会花 ~1 次模型调用)
//   baseUrl 默认 http://127.0.0.1:3080
//
// 副作用:创建一个 scratch session(结束后 archive),在其上跑
//   goal.create→edit→pause→resume→complete→clear 全生命周期,并 prompt 一个
//   run_in_background 的 bash 任务以捕获 session/jobs 帧。fork 测试用仓库内
//   已有 completed-turn 会话(只读),不新造。

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ARGS = process.argv.slice(2);
const base = (ARGS.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:3080').replace(/\/$/, '');
const DO_WS = !ARGS.includes('--no-ws');
const DO_GOAL = !ARGS.includes('--no-goal');
const DO_PROMPT = !ARGS.includes('--no-prompt');
const JOB_WAIT_MS = Number(ARGS.find((a) => a.startsWith('--job-wait='))?.split('=')[1] ?? 90_000);

let rpcId = 0;
/** POST /api/<method> 信封调用,返回 {http, ok, err, value} */
async function call(method, payload = {}) {
  let res;
  try {
    res = await fetch(`${base}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `p3-${++rpcId}`, method, payload }),
    });
  } catch (error) {
    return { http: 0, ok: false, err: `network:${error instanceof Error ? error.message : String(error)}` };
  }
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed || parsed.type !== 'server-response') return { http: res.status, ok: false, err: `bad-envelope:${text.slice(0, 100)}` };
  const r = parsed.result;
  const ok = r?.ok === true;
  return {
    http: res.status,
    ok,
    err: !ok && r?.error ? `${r.error.code}:${r.error.message}` : '',
    value: ok ? r.value : undefined,
  };
}

/** 打开 WS downlink,持续采集帧(close() 停止) */
function openCollector(path, sink) {
  const ws = new WebSocket(`ws://${base.replace(/^http:\/\//, '')}${path}`);
  ws.onmessage = (e) => {
    try { sink(JSON.parse(String(e.data))); } catch { sink({ method: '(parse-error)' }); }
  };
  ws.onerror = () => sink({ method: '(ws-error)' });
  return ws;
}

/** 帧的判别名:信封 method 优先,其次 payload.type */
const frameKind = (f) => f?.method ?? f?.payload?.type ?? f?.type ?? '(?)';

const trunc = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length <= n ? s : `${s.slice(0, n)}…(${s.length}B)`;
};

const out = { base, at: new Date().toISOString(), unary: [], frames: { mux: [], host: [] }, jobs: [] };
const muxFrames = out.frames.mux;
const hostFrames = out.frames.host;

const record = (method, payload, r) => {
  out.unary.push({ method, payload, http: r.http, ok: r.ok, err: r.err, value: r.value === undefined ? undefined : trunc(r.value, 220) });
  const line = `${method.padEnd(34)} -> http=${r.http} ok=${r.ok}${r.err ? ` ERR ${r.err}` : ''}${r.value !== undefined ? ` ${trunc(r.value, 120)}` : ''}`;
  console.log(line);
  return r;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  let wsMux, wsHost;
  if (DO_WS) {
    wsMux = openCollector('/api/events.mux', (f) => muxFrames.push(f));
    wsHost = openCollector('/api/events.host', (f) => hostFrames.push(f));
  }
  await wait(400); // 等 WS 就绪

  console.log(`== A. 只读端点 == (base=${base})`);
  const host = record('host.describe', {}, await call('host.describe'));
  console.log(`   host: ${host.value ? trunc(host.value, 220) : '-'}`);
  const list = record('session.list', {}, await call('session.list'));
  const mainSession = list.value?.items?.find((i) => !i.blank)?.sessionId;
  console.log(`   mainSession(有turn)=${mainSession ?? '(无)'}`);
  record('workspace.list', {}, await call('workspace.list'));
  const settings = record('settings.describe', {}, await call('settings.describe'));
  console.log(`   settings.describe keys=${settings.value ? Object.keys(settings.value).join(',') : '-'}`);
  record('llm.providers', {}, await call('llm.providers'));
  record('llm.models', {}, await call('llm.models'));
  record('agentPreset.list', {}, await call('agentPreset.list'));
  record('credentials.describe', { refs: [] }, await call('credentials.describe', { refs: [] }));
  if (mainSession) {
    const skill = record('skill.list', { sessionId: mainSession }, await call('skill.list', { sessionId: mainSession }));
    console.log(`   skills=${skill.value ? JSON.stringify(skill.value.skills?.map((s) => s.name)) : '-'} modelInvocable=${skill.value?.skills?.map((s) => s.modelInvocable).join(',')}`);
    const sub = record('subagent.list', { parentSessionId: mainSession }, await call('subagent.list', { parentSessionId: mainSession }));
    console.log(`   subagent entries=${sub.value?.entries?.length ?? '?'} parentAvailable=${sub.value?.parentAvailable}`);
    record('session.history', { sessionId: mainSession, maxMessages: 2 }, await call('session.history', { sessionId: mainSession, maxMessages: 2 }));
  }

  console.log('\n== B. 负向探测(预期 404:仅推送帧/无此端点)==');
  record('mcp.list', {}, await call('mcp.list'));
  record('jobs.list', {}, await call('jobs.list'));
  record('goal.list', {}, await call('goal.list'));
  record('sandbox.describe', {}, await call('sandbox.describe'));
  record('subagent.list', {}, await call('subagent.list')); // 缺 parentSessionId → 应 bad-request

  let scratch;
  if (DO_GOAL) {
    console.log('\n== C. 副作用生命周期(scratch session)==');
    const created = record('session.create', {}, await call('session.create'));
    scratch = created.value?.sessionId;
    console.log(`   scratch=${scratch ?? '(创建失败)'}`);
    if (scratch) {
      // goal 全生命周期:ref 必须链式取每次响应的最新值(实测:每次变更 revision+1)
      let r = record('goal.create', { sessionId: scratch, objective: 'probe: phase3 goal lifecycle smoke', maxGoalRounds: 1 }, await call('goal.create', { sessionId: scratch, objective: 'probe: phase3 goal lifecycle smoke', maxGoalRounds: 1 }));
      let ref = r.value?.ref;
      console.log(`   goal ref=${ref ? JSON.stringify(ref) : '-'}`);
      if (ref) {
        r = record('goal.edit', { sessionId: scratch, ref, objective: 'probe: phase3 goal lifecycle smoke (edited)' }, await call('goal.edit', { sessionId: scratch, ref, objective: 'probe: phase3 goal lifecycle smoke (edited)' }));
        ref = r.value?.ref ?? ref;
        r = record('goal.pause', { sessionId: scratch, ref }, await call('goal.pause', { sessionId: scratch, ref }));
        ref = r.value?.ref ?? ref;
        await wait(300);
        r = record('goal.resume', { sessionId: scratch, ref }, await call('goal.resume', { sessionId: scratch, ref }));
        ref = r.value?.ref ?? ref;
        r = record('goal.complete', { sessionId: scratch, ref }, await call('goal.complete', { sessionId: scratch, ref }));
        ref = r.value?.ref ?? ref;
        await wait(300);
        r = record('goal.clear', { sessionId: scratch, ref }, await call('goal.clear', { sessionId: scratch, ref }));
      }
      record('session.rename', { sessionId: scratch, title: 'probe-phase3-scratch' }, await call('session.rename', { sessionId: scratch, title: 'probe-phase3-scratch' }));
    }
    // fork 需要 completed turn:用仓库内已有非 blank 会话(只读,不污染)
    const forkFrom = list.value?.items?.find((i) => !i.blank)?.sessionId;
    if (forkFrom) {
      console.log(`   fork 源(有turn)=${forkFrom}`);
      const fk = record('session.fork', { sessionId: forkFrom }, await call('session.fork', { sessionId: forkFrom }));
      const forkId = fk.value?.sessionId;
      if (forkId) {
        record('session.cancel', { sessionId: forkId }, await call('session.cancel', { sessionId: forkId }));
        record('workspace.archiveSession', { sessionId: forkId }, await call('workspace.archiveSession', { sessionId: forkId }));
      }
    }
  } else {
    console.log('\n== C. 副作用生命周期 == (--no-goal,跳过)');
  }

  if (DO_PROMPT && scratch) {
    console.log(`\n== D. 真实 background job 捕获(等待 ≤${JOB_WAIT_MS / 1000}s)==`);
    const before = muxFrames.length;
    const p = record('session.prompt', {
      sessionId: scratch,
      mode: 'queue',
      content: [{ type: 'text', text: '用 bash 工具执行 `sleep 2 && echo probe-job-done`,必须设置 run_in_background: true;然后用 job_output 等待它结束,最后回复 "probe-job-done"。' }],
    }, await call('session.prompt', {
      sessionId: scratch,
      mode: 'queue',
      content: [{ type: 'text', text: '用 bash 工具执行 `sleep 2 && echo probe-job-done`,必须设置 run_in_background: true;然后用 job_output 等待它结束,最后回复 "probe-job-done"。' }],
    }));
    console.log(`   prompt accepted=${p.value?.accepted ?? p.err}`);
    const deadline = Date.now() + JOB_WAIT_MS;
    const jobSeen = () => muxFrames.slice(before).some((f) => f.method === 'session/jobs' || f.payload?.event?.type === 'tool/call' && String(f.payload?.event?.data?.name).startsWith('bash'));
    while (Date.now() < deadline && !jobSeen()) await wait(1000);
    await wait(3000); // 再收一会儿,尽量拿到含 finishedAt 的最终帧
    const jobsFrames = muxFrames.slice(before).filter((f) => f.method === 'session/jobs');
    out.jobs = jobsFrames.map((f) => f.payload);
    for (const jf of jobsFrames) console.log(`   session/jobs 帧:${trunc(jf, 300)}`);
    if (jobsFrames.length === 0) console.log('   (未捕获到 session/jobs 帧)');
    record('session.cancel', { sessionId: scratch }, await call('session.cancel', { sessionId: scratch }));
  } else {
    console.log('\n== D. 真实 background job 捕获 == 跳过(--no-prompt 或无 scratch)');
    if (scratch) record('session.cancel', { sessionId: scratch }, await call('session.cancel', { sessionId: scratch }));
  }

  if (DO_GOAL && scratch) {
    console.log('\n== E. 清理:archive scratch session ==');
    record('workspace.archiveSession', { sessionId: scratch }, await call('workspace.archiveSession', { sessionId: scratch }));
  }

  if (DO_WS) {
    console.log('\n== F. WS 帧统计(按 method)==');
    const count = (arr) => {
      const m = new Map();
      for (const f of arr) { const k = frameKind(f); m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].map(([t, n]) => `${t}×${n}`).join(' ');
    };
    console.log(`   events.mux (${muxFrames.length}): ${count(muxFrames) || '(无帧)'}`);
    console.log(`   events.host (${hostFrames.length}): ${count(hostFrames) || '(无帧)'}`);
    const sample = muxFrames.find((f) => f.method === 'session/jobs') ?? muxFrames.find((f) => f.method === 'session/event' && f.payload?.event?.type === 'goal/change') ?? muxFrames.find((f) => f.method === 'session/event');
    if (sample) console.log(`   样本帧:${trunc(sample, 500)}`);
    wsMux?.close();
    wsHost?.close();
  }

  console.log('\n== 摘要 ==');
  const bad = out.unary.filter((u) => !u.ok && u.http !== 404);
  console.log(`   unary 调用 ${out.unary.length} 条,ok=${out.unary.filter((u) => u.ok).length},预期404=${out.unary.filter((u) => u.http === 404).length},非404失败=${bad.length}`);
  for (const b of bad) console.log(`   ✗ ${b.method} ${b.err}`);
  console.log(`   mux 帧方法 ${new Set(muxFrames.map(frameKind)).size} 种 / host 帧方法 ${new Set(hostFrames.map(frameKind)).size} 种`);
  // 每种帧方法附第一个完整样本(不截断),供 wire 类型实现参考;原始帧不落盘(体积大,计数与形状已足够)
  const firstOf = (arr) => {
    const seen = new Set();
    const samples = [];
    for (const f of arr) { const k = frameKind(f); if (!seen.has(k)) { seen.add(k); samples.push({ kind: k, frame: f }); } }
    return samples;
  };
  const countOf = (arr) => {
    const m = new Map();
    for (const f of arr) { const k = frameKind(f); m.set(k, (m.get(k) ?? 0) + 1); }
    return Object.fromEntries(m);
  };
  out.frames = { mux: { count: muxFrames.length, methods: countOf(muxFrames) }, host: { count: hostFrames.length, methods: countOf(hostFrames) } };
  out.frameSamples = { mux: firstOf(muxFrames), host: firstOf(hostFrames) };
  const resultPath = resolve(import.meta.dirname, '../../../docs/probe-phase3-result.json');
  writeFileSync(resultPath, JSON.stringify(out, null, 2));
  console.log(`   原始结果 → ${resultPath}`);
};

main().catch((error) => { console.error('probe 失败:', error); process.exitCode = 1; });
