/**
 * smoke-layout.mjs — 子测试: Phase 9 布局 + 导航 + 窄宽度。
 * 环境变量: SMOKE_RELAY_PORT, SMOKE_STATIC_PORT
 */
import { bootPage } from './smoke-helpers.mjs';

const rp = Number(process.env.SMOKE_RELAY_PORT) || 8961;
const sp = Number(process.env.SMOKE_STATIC_PORT) || 8960;

const { browser, page } = await bootPage(rp, sp);
const failures = [];

// ---- 对话模式布局 ----
const chatLayout = await page.evaluate(() => {
  const frame = document.querySelector('[class$="_frame"]');
  const frameStyle = frame === null ? null : getComputedStyle(frame);
  return {
    grid: frameStyle === null ? '(无 frame)' : frameStyle.gridTemplateColumns,
    frameWidth: frame === null ? -1 : frame.getBoundingClientRect().width,
    backButton: document.querySelector('.dsh-back-button') !== null,
    backInTitleRow: document.querySelector('.dsh-back-title') !== null
      || document.querySelector('.dsh-back-floating') !== null,
    host: document.body.dataset.dshHost ?? '(未设置)',
  };
});

if (typeof chatLayout.grid !== 'string' || !chatLayout.grid.startsWith('0px') || !chatLayout.grid.endsWith('0px')) {
  failures.push(`对话模式 frame 网格非 0|1fr|0:${chatLayout.grid}`);
}
if (!chatLayout.backButton) failures.push('对话模式缺少返回按钮');
if (!chatLayout.backInTitleRow) failures.push('返回按钮不在 title 行内或浮动兜底');
if (chatLayout.host !== 'sidebar') failures.push(`__DSH_HOST__ 未注入:${chatLayout.host}`);

// ---- 进入会话管理页 ----
await page.click('.dsh-back-button');
await page.waitForTimeout(1200);

const sessionsLayout = await page.evaluate(() => {
  const root = document.getElementById('root');
  const sessionsRoot = document.getElementById('dsh-sessions-root');
  return {
    sessionsClass: document.body.classList.contains('dsh-sessions'),
    rootDisplay: root === null ? '(无 root)' : getComputedStyle(root).display,
    sessionsRootVisible: sessionsRoot !== null && !sessionsRoot.hidden,
    headerPresent: document.querySelector('.dsh-session-header') !== null,
    logoPresent: document.querySelector('.dsh-session-logo') !== null,
    backInHeaderGone: (() => {
      const header = document.querySelector('.dsh-session-header');
      return header !== null && header.querySelector('.dsh-session-back') === null;
    })(),
    newInFooter: (() => {
      const footer = document.querySelector('.dsh-session-footer');
      return footer !== null && footer.querySelector('.dsh-session-new') !== null;
    })(),
    newBtnPresent: document.querySelector('.dsh-session-new') !== null,
    rows: document.querySelectorAll('.dsh-session-row').length,
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
    storedView: localStorage.getItem('dsh.ui.view'),
    backButtons: document.querySelectorAll('.dsh-back-button').length,
  };
});

if (!sessionsLayout.sessionsClass) failures.push('返回按钮未进入会话管理页');
if (sessionsLayout.rootDisplay !== 'none') failures.push(`会话页未隐藏上游 #root(display=${sessionsLayout.rootDisplay})`);
if (!sessionsLayout.sessionsRootVisible) failures.push('会话页 #dsh-sessions-root 不可见');
if (!sessionsLayout.headerPresent) failures.push('会话页缺少 header');
if (!sessionsLayout.logoPresent) failures.push('会话页 logo 丢失');
if (!sessionsLayout.backInHeaderGone) failures.push('会话页 header 仍含返回按钮');
if (!sessionsLayout.newInFooter) failures.push('会话页新建按钮不在底部');
if (!sessionsLayout.newBtnPresent) failures.push('会话页缺少新建会话按钮');
if (sessionsLayout.rows < 1) failures.push(`会话页无会话行(rows=${sessionsLayout.rows})`);
if (sessionsLayout.backButtons !== 0) failures.push(`会话页残留返回按钮(${sessionsLayout.backButtons})`);
if (!sessionsLayout.noHScroll) failures.push('会话页横向滚动');
if (sessionsLayout.storedView !== 'sessions') failures.push('视图偏好未持久化');

// ---- 会话行点击跳转 ----
if (sessionsLayout.rows > 0) {
  const sessionJump = await page.evaluate(async () => {
    return new Promise((resolve) => {
      let posted = false;
      const onMsg = (event) => {
        const msg = event.data;
        if (msg && typeof msg === 'object' && msg.type === 'switch-session:applied') {
          posted = true;
          window.removeEventListener('message', onMsg);
          resolve({
            posted,
            stored: localStorage.getItem('dsh.sessions.current'),
            view: localStorage.getItem('dsh.ui.view'),
          });
        }
      };
      window.addEventListener('message', onMsg);
      const row = document.querySelector('.dsh-session-row');
      row.click();
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ posted, stored: localStorage.getItem('dsh.sessions.current'), view: localStorage.getItem('dsh.ui.view') });
      }, 1500);
    });
  });
  if (!sessionJump.posted) failures.push('点击会话行未回传 switch-session:applied');
  if (sessionJump.stored === null) failures.push('点击会话行未写入 dsh.sessions.current');
  if (sessionJump.view !== 'chat') failures.push(`点击会话行后视图偏好未回 chat:${sessionJump.view}`);
}

// ---- 窄宽度 ----
await page.setViewportSize({ width: 320, height: 600 });
await page.waitForTimeout(400);
const narrowOverflow = await page.evaluate(() => ({
  noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
}));
if (!narrowOverflow.noHScroll) failures.push('320px 出现横向滚动');

console.log(JSON.stringify({ module: 'layout', failures }));
await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
