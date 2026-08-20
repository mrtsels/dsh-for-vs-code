/**
 * smoke-boot.mjs — 子测试: boot 链 + connection + bridge 契约。
 * 环境变量: SMOKE_RELAY_PORT, SMOKE_STATIC_PORT
 * 退出码 0=pass, 1=fail; stdout = JSON 结果。
 */
import { bootPage } from './smoke-helpers.mjs';

const rp = Number(process.env.SMOKE_RELAY_PORT) || 8961;
const sp = Number(process.env.SMOKE_STATIC_PORT) || 8960;

const { browser, page, state, consoleMsgs } = await bootPage(rp, sp);
const failures = [];

// 1. boot 健康
if (state.rootChildren < 1) failures.push('UI 未渲染(root 空)');
if (state.rootChildren < 1 && state.errBannerInfo !== '(无)') failures.push(`root 空但存在错误横幅:${state.errBannerInfo}`);

// 2. console 致命错误
if (consoleMsgs.some((m) => m.includes('[pageerror]'))) {
  const errs = consoleMsgs.filter((m) => m.includes('[pageerror]'));
  failures.push(`pageerror:${errs.join(';').slice(0, 200)}`);
}

// 3. 背景透明
const transparentOk = (bg) => bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || bg === 'rgb(0, 0, 0)';
if (!transparentOk(state.bodyBg)) failures.push(`body 背景非透明:${state.bodyBg}`);
if (typeof state.frameBg === 'string' && !transparentOk(state.frameBg)) failures.push(`frame 背景非透明:${state.frameBg}`);

// 4. bridge 契约
const bridgeOk = await page.evaluate(() => {
  return new Promise((resolve) => {
    const done = () => resolve(true);
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'switch-session:applied') done();
    }, { once: true });
    window.postMessage({ type: 'dsh:switch-session', sessionId: 'smoke-bridge-test' }, '*');
    setTimeout(() => resolve(localStorage.getItem('dsh.sessions.current') !== null), 1500);
  });
});
if (!bridgeOk) failures.push('会话切换桥未生效(localStorage 未写入)');

// 5. slot 双注册
if (consoleMsgs.some((m) => m.includes('already has a registration'))) failures.push('存在 slot 双注册冲突');

console.log(JSON.stringify({ module: 'boot', failures, state, consoleMsgs: consoleMsgs.slice(0, 10) }));
await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
