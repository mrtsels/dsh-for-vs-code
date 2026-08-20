/**
 * smoke-shell.mjs — 父编排器:启动服务器 → 并行 spawn 3 个子测试 → 汇总结果。
 *
 * 子测试各自 boot 独立浏览器页面(并行),互不干扰。
 * 总耗时 ≈ boot 时间(10s) + max(子测试断言时间) ≈12s。
 *
 * 用法: node scripts/smoke-shell.mjs
 * 前置: vendor 已 build + dsh-shell 已装配 + 3080 在线(可选)
 */
import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServers } from './smoke-helpers.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = __dir;
const STATIC_PORT = 8960;
const RELAY_PORT = 8961;

// ---- 1. 启动共享服务器 ----
const { shutdown, relayLog } = await createServers(STATIC_PORT, RELAY_PORT);
console.log(`servers up (static=${STATIC_PORT}, relay=${RELAY_PORT})`);

// ---- 2. 并行 spawn 子测试 ----
const tests = ['smoke-boot.mjs', 'smoke-layout.mjs', 'smoke-attach.mjs'];

function runTest(script) {
  return new Promise((resolve) => {
    const child = fork(join(SCRIPTS, script), {
      env: {
        ...process.env,
        SMOKE_STATIC_PORT: String(STATIC_PORT),
        SMOKE_RELAY_PORT: String(RELAY_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      timeout: 60000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      resolve({ script, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', (err) => {
      resolve({ script, code: 1, stdout: '', stderr: String(err) });
    });
  });
}

console.log(`running ${tests.length} tests in parallel…`);
const t0 = Date.now();
const results = await Promise.all(tests.map(runTest));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ---- 3. 汇总 ----
let allPass = true;
for (const r of results) {
  const tag = r.code === 0 ? '✅' : '❌';
  console.log(`\n${tag} ${r.script} (${r.code === 0 ? 'PASS' : 'FAIL'})`);
  if (r.stdout) {
    // 尝试解析 JSON 输出
    try {
      const data = JSON.parse(r.stdout);
      if (data.failures?.length > 0) {
        allPass = false;
        for (const f of data.failures) console.log(`  - ${f}`);
      }
    } catch {
      // 非 JSON:直接输出
      console.log(`  ${r.stdout.slice(0, 500)}`);
    }
  }
  if (r.stderr && r.code !== 0) {
    console.log(`  stderr: ${r.stderr.slice(0, 300)}`);
  }
}

// 父进程级检查:relay 日志
const hasRpc = relayLog.some((l) => l.includes('/api/'));
const wsOk = relayLog.some((l) => l.includes('WS connected'));
if (!hasRpc) { console.log('\n⚠ relay: 无 RPC 到达 3080'); allPass = false; }
if (!wsOk) { console.log('\n⚠ relay: WS 事件流未建立'); allPass = false; }

shutdown();

console.log(`\n${'='.repeat(50)}`);
console.log(`SMOKE ${allPass ? 'PASS' : 'FAIL'}: ${tests.length} tests, ${elapsed}s`);
process.exit(allPass ? 0 : 1);
