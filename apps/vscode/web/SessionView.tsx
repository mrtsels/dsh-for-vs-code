/**
 * SessionView.tsx — 会话管理页(独立单栏页面,非侧边栏拉伸)。
 *
 * 背景(2026-08-19 用户决策,取代 08-18 的"Workspaces 全宽单栏=拉伸侧边栏"):
 * 上游 dsh web UI 没有独立的会话管理视图(WorkspaceBrowser 就是侧边栏内容,数据 store
 * 内联在 React context 里,外部不可直接调用)。因此本页是**扩展自有 React 视图**:
 *
 *   - 数据:与上游同源 —— 经 __DSH_WEB_URL__(扩展代理)调 session.list + workspace.list
 *     RPC(与上游 workspace store 同一 wire 契约),不做本地缓存/硬编码;
 *   - 跳转:点击会话行 → 写 localStorage dsh.sessions.current(上游 attachPersistence
 *     恢复键)→ 回传 switch-session:applied → 扩展重载 webview → 应用 boot 直接进入
 *     该会话(与 dsh:bootstrap-session 同一机制;无 setTimeout、不依赖 workspace 展开);
 *   - 新建:header 的 + 按钮 → dsh:new-session(扩展按 VS Code 当前目录建会话并接管;
 *     2026-08-20 修:bridge 的 bootstrap 处理同步把 dsh.ui.view 重置为 chat,否则从本页
 *     新建后重载仍回本页);
 *   - 页头仅居中品牌 wordmark,无返回键(2026-08 用户要求:去掉左上角返回);切回对话
 *     靠点击会话行(打开即跳转),视图切换由 bridge 控制 #root 与 #dsh-sessions-root 显隐。
 *   - Agent Mode:由上游原生 UI 提供(ui-agent-preset 插件):对话页 header title 右侧的
 *     AgentPresetLabel + 新会话屏 hero 的 AgentPresetSeat 模式选择;本页不重复自绘
 *     (2026-08 用户要求:使用 dsh 上游原生 UI)。
 *
 * 2026-08-20 P1+P2(用户反馈:官方外观 / 点击失效 / 分组+状态+归档折叠):
 *   - 分组:workspace.list.sessionIds 反向索引分组;无归属进"未分组";archivedSessionIds
 *     进"已归档"段(默认折叠)。归档/子代理/非当前 blank 按上游 sessionVisible 语义隐藏。
 *   - 子代理嵌套:仅 origin==='subagent' 的会话按 parentSessionId 挂在父行下(递归、可折叠,
 *     默认展开);父不可见时提升为顶层(未分组),不丢失。fork 子代(parentSessionId 非空但
 *     origin 非 subagent)维持上游语义 = 普通顶层行,不嵌套。
 *   - 行操作菜单(⋯):重命名(session.rename)/ 分叉(session.fork)/ 归档
 *     (workspace.archiveSession);会话级无 delete(上游无此 RPC,delete 仅 workspace 级)。
 *     操作成功后重新拉取数据。自绘 menu(overlay 点击外部 / Escape 关闭)与重命名对话框,
 *     不依赖 vendor Menu/Modal。
 *   - 视觉:行结构(状态点槽 + 标题 + 元信息)、段头(三角箭头 + 文件夹图标 + 标题 + 计数)、
 *     相对时间与图标 SVG 均按上游 ui-workspace Rows.tsx / ui-primitives 提取移植。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    __DSH_LOCALE__?: string;
    __DSH_WEB_URL__?: string;
    __dshBridge?: {
      setView: (view: 'chat' | 'sessions') => void;
      /** 回传宿主:bridge 持有唯一一次 acquireVsCodeApi,自建页不得二次 acquire。 */
      postToHost?: (message: unknown) => void;
    };
  }
}

/** 回传宿主:优先走 bridge 持有的 VS Code API 实例。
 * 2026-08-20 根因:acquireVsCodeApi 每个 webview 只能 acquire 一次(第二次调用在真实
 * webview 抛 'An instance of the VS Code API has already been acquired'),且 VS Code 会把
 * window.parent 指向自身 —— 二次 acquire 失败后的 window.parent.postMessage 回退是自我
 * 投递(静默丢弃),这就是真实 webview 点击会话"无反应"、headless 却通过的原因(后者
 * window.parent 是测试 harness 帧,真的接收)。bridge.js 在 head 先于本页执行并持有唯一
 * acquire,故此处一律经 window.__dshBridge.postToHost;无 bridge 的独立调试环境才回退。 */
const postToHost = (message: unknown): void => {
  const bridgePost = window.__dshBridge?.postToHost;
  if (typeof bridgePost === 'function') {
    bridgePost(message);
    return;
  }
  try {
    window.parent.postMessage(message, '*');
  } catch {
    /* 忽略 */
  }
};

/** 与 bridge 一致的 RPC 信封:代理改写 origin,webview 侧无需关心 Origin 栅栏。 */
const rpc = (method: string, payload: unknown): Promise<unknown> => {
  const base = window.__DSH_WEB_URL__ ?? '';
  if (base === '') return Promise.reject(new Error('no __DSH_WEB_URL__'));
  return fetch(base + '/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'session-view-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      method,
      payload,
    }),
  }).then((res) => res.json());
};

/** 语言:__DSH_LOCALE__(VS Code 设置)优先,follow-web/空 按浏览器语言。 */
const ui = (): 'zh' | 'en' => {
  const l = window.__DSH_LOCALE__;
  if (l === 'zh' || l === 'en') return l;
  return (navigator.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
};
const str = (zh: string, en: string): string => (ui() === 'zh' ? zh : en);

/* ---- 空心(outline)图标:不用实心/Unicode 符号 ---- */
const PlusIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

/* ---- 上游 ui-primitives 图标移植(与官方同 SVG path) ---- */
const FolderOpenIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z" fill="currentColor" />
    <path opacity="0.2" d="M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z" fill="currentColor" />
  </svg>
);

const FolderCloseIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path transform="translate(1.5 2.429)" d="M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z" fill="currentColor" />
  </svg>
);

const TriangleRightIcon = (): React.JSX.Element => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M4.25 2.82782L4.25 11.1722C4.25 11.6622 4.84243 11.9076 5.18891 11.5611L9.36109 7.38891C9.57588 7.17412 9.57588 6.82588 9.36109 6.61109L5.18891 2.43891C4.84243 2.09243 4.25 2.33782 4.25 2.82782Z" fill="currentColor" />
  </svg>
);

const EllipsisIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z" fill="currentColor" />
    <path d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z" fill="currentColor" />
    <path d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z" fill="currentColor" />
  </svg>
);

const EditIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z" fill="currentColor" />
  </svg>
);

const BranchIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="currentColor" />
  </svg>
);

const ArchiveIcon = (): React.JSX.Element => (
  <svg width={16} height={16} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9508 3.98631 16.4649 3.50019 15.8659 3.50019H4.1341ZM6.00059 9.5834C5.80296 9.5834 5.64355 9.74285 5.64355 9.94052C5.64355 10.1381 5.80296 10.2976 6.00059 10.2976H14.0006C14.1982 10.2976 14.3576 10.1381 14.3576 9.94052C14.3576 9.74285 14.1982 9.5834 14.0006 9.5834H6.00059Z" fill="currentColor" />
  </svg>
);

const BrandWordmark = (): React.JSX.Element => (
  <svg
    width={189.28}
    height={24.96}
    viewBox="0 0 182 24"
    fill="none"
    className="dsh-session-logo"
    aria-hidden="true"
  >
    <path d="M68.416 18.2447H67.0501V16.1272H68.416C69.2619 16.1272 70.1166 15.9163 70.6671 15.3304C71.2181 14.7444 71.426 13.8455 71.426 12.9471C71.426 12.0487 71.2268 11.1498 70.6671 10.5643C70.1083 9.97831 69.2619 9.76744 68.416 9.76744C67.5701 9.76744 66.7154 9.97831 66.1639 10.5643C65.6129 11.1503 65.4049 12.0487 65.4049 12.9471V21.6435H63.009V7.6582H65.4049V8.54883H65.8442C65.8918 8.49393 65.9394 8.44728 65.9875 8.40064C66.5871 7.85353 67.5049 7.6582 68.4072 7.6582C69.8212 7.6582 71.2341 8.00998 72.1607 8.98662C73.0868 9.96325 73.4143 11.4632 73.4143 12.9558C73.4143 14.4485 73.0785 15.9406 72.1607 16.925C71.2424 17.9094 69.8212 18.2457 68.416 18.2457V18.2447Z" fill="currentColor"/>
    <path d="M31.9551 8.03497H33.3204V10.1525H31.9551C31.1087 10.1525 30.2545 10.3633 29.7035 10.9493C29.1525 11.5353 28.945 12.4342 28.945 13.3326C28.945 14.231 29.1447 15.1294 29.7035 15.7154C30.2623 16.3014 31.1087 16.5122 31.9551 16.5122C32.8015 16.5122 33.6562 16.3014 34.2072 15.7154C34.7582 15.1294 34.9657 14.231 34.9657 13.3326V4.62842H37.3611V18.6219H34.9657V17.7313H34.5264C34.4783 17.7857 34.4307 17.8329 34.3826 17.8795C33.7835 18.4261 32.8652 18.6219 31.9629 18.6219C30.5494 18.6219 29.136 18.2707 28.2099 17.294C27.2838 16.3174 26.9563 14.817 26.9563 13.3248C26.9563 11.8327 27.2916 10.34 28.2099 9.35561C29.136 8.37898 30.5494 8.03497 31.9551 8.03497Z" fill="currentColor"/>
    <path d="M49.3786 13.1431V13.9948H42.9984V12.2996H47.2305C47.1348 11.6825 46.9113 11.1043 46.5119 10.682C45.9371 10.0727 45.0503 9.85409 44.1723 9.85409C43.2943 9.85409 42.4076 10.0727 41.8328 10.682C41.258 11.2913 41.05 12.2213 41.05 13.1435C41.05 14.0658 41.2575 15.003 41.8328 15.6046C42.4076 16.2061 43.2939 16.433 44.1723 16.433C45.0508 16.433 45.9371 16.2143 46.5119 15.6046C46.5916 15.5186 46.6635 15.4248 46.7354 15.331H49.0992C48.8918 16.0657 48.5643 16.7299 48.0691 17.2454C47.111 18.2531 45.6339 18.6205 44.1723 18.6205C42.7108 18.6205 41.2337 18.2609 40.2755 17.2454C39.3174 16.2299 38.9661 14.6828 38.9661 13.1435C38.9661 11.6043 39.3096 10.0494 40.2755 9.04168C41.242 8.03396 42.7108 7.66663 44.1723 7.66663C45.6339 7.66663 47.111 8.02618 48.0691 9.04168C49.0351 10.0572 49.3786 11.6043 49.3786 13.1435V13.1431Z" fill="currentColor"/>
    <path d="M61.4045 13.1431V13.9948H55.0243V12.2996H59.2564C59.1602 11.6825 58.9372 11.1043 58.5378 10.682C57.963 10.0727 57.0762 9.85409 56.1982 9.85409C55.3202 9.85409 54.4335 10.0727 53.8587 10.682C53.2839 11.2913 53.0759 12.2213 53.0759 13.1435C53.0759 14.0658 53.2834 15.003 53.8587 15.6046C54.4335 16.2061 55.3202 16.433 56.1982 16.433C57.0762 16.433 57.963 16.2143 58.5378 15.6046C58.6179 15.5186 58.6894 15.4248 58.7608 15.331H61.1251C60.9171 16.0657 60.5897 16.7299 60.0945 17.2454C59.1364 18.2531 57.6593 18.6205 56.1982 18.6205C54.7372 18.6205 53.2596 18.2609 52.3014 17.2454C51.3432 16.2299 50.9919 14.6828 50.9919 13.1435C50.9919 11.6043 51.3355 10.0494 52.3014 9.04168C53.2678 8.03396 54.7367 7.66663 56.1982 7.66663C57.6598 7.66663 59.1364 8.02618 60.0945 9.04168C61.061 10.0572 61.4045 11.6043 61.4045 13.1435V13.1431Z" fill="currentColor"/>
    <path d="M80.242 18.6214C81.7035 18.6214 83.1801 18.4105 84.1383 17.809C85.0965 17.2075 85.4482 16.2931 85.4482 15.3869C85.4482 14.4807 85.1042 13.5585 84.1383 12.9647C83.1801 12.371 81.703 12.1518 80.242 12.1518C79.6186 12.1518 79.0438 12.0658 78.6366 11.8394C78.2294 11.6047 78.0778 11.2534 78.0778 10.9017C78.0778 10.5499 78.2216 10.1908 78.6366 9.9639C79.0438 9.72921 79.6749 9.65147 80.2973 9.65147C80.9198 9.65147 81.5509 9.73747 81.9591 9.9639C82.3663 10.1986 82.5179 10.5499 82.5179 10.9017H84.9531C84.9531 9.99499 84.6421 9.07327 83.7719 8.47951C82.9017 7.88576 81.5679 7.66663 80.2424 7.66663C78.9169 7.66663 77.5837 7.8775 76.713 8.47951C75.8427 9.08104 75.5308 9.99499 75.5308 10.9017C75.5308 11.8083 75.8423 12.73 76.713 13.3238C77.5832 13.9176 78.9165 14.1367 80.2424 14.1367C80.929 14.1367 81.688 14.2227 82.1428 14.4491C82.5985 14.676 82.7579 15.0351 82.7579 15.3869C82.7579 15.7387 82.5985 16.0977 82.1428 16.3246C81.688 16.5511 80.9931 16.6371 80.3066 16.6371C79.62 16.6371 78.9169 16.5511 78.4694 16.3246C78.0224 16.0982 77.8543 15.7387 77.8543 15.3869H75.0435C75.0435 16.2935 75.3865 17.2153 76.3534 17.809C77.3194 18.4028 78.7809 18.6214 80.2424 18.6214H80.242Z" fill="currentColor"/>
    <path d="M97.4733 13.1431V13.9948H91.0932V12.2996H95.3252C95.23 11.6825 95.006 11.1043 94.6071 10.682C94.0313 10.0727 93.1456 9.85409 92.2666 9.85409C91.3876 9.85409 90.5018 10.0727 89.927 10.682C89.3522 11.2913 89.1452 12.2213 89.1452 13.1435C89.1452 14.0658 89.3522 15.003 89.927 15.6046C90.5018 16.2061 91.3886 16.433 92.2666 16.433C93.1446 16.433 94.0313 16.2143 94.6071 15.6046C94.6863 15.5186 94.7587 15.4248 94.8301 15.331H97.1935C96.9855 16.0657 96.6585 16.7299 96.1639 17.2454C95.2057 18.2531 93.7281 18.6205 92.2666 18.6205C90.805 18.6205 89.3284 18.2609 88.3703 17.2454C87.4121 16.2299 87.0613 14.6828 87.0613 13.1435C87.0613 11.6043 87.4043 10.0494 88.3703 9.04168C89.3367 8.03396 90.806 7.66663 92.2666 7.66663C93.7272 7.66663 95.2057 8.02618 96.1639 9.04168C97.1298 10.0572 97.4729 11.6043 97.4729 13.1435L97.4733 13.1431Z" fill="currentColor"/>
    <path d="M109.499 13.1431V13.9948H103.119V12.2996H107.351C107.256 11.6825 107.032 11.1043 106.632 10.682C106.057 10.0727 105.172 9.85409 104.293 9.85409C103.414 9.85409 102.528 10.0727 101.953 10.682C101.378 11.2913 101.17 12.2213 101.17 13.1435C101.17 14.0658 101.378 15.003 101.953 15.6046C102.528 16.2061 103.415 16.433 104.293 16.433C105.171 16.433 106.057 16.2143 106.632 15.6046C106.712 15.5186 106.784 15.4248 106.856 15.331H109.22C109.012 16.0657 108.685 16.7299 108.19 17.2454C107.231 18.2531 105.754 18.6205 104.293 18.6205C102.831 18.6205 101.355 18.2609 100.396 17.2454C99.4382 16.2299 99.0864 14.6828 99.0864 13.1435C99.0864 11.6043 99.4295 10.0494 100.396 9.04168C101.362 8.03396 102.832 7.66663 104.293 7.66663C105.754 7.66663 107.231 8.02618 108.19 9.04168C109.156 10.0572 109.499 11.6043 109.499 13.1435V13.1431Z" fill="currentColor"/>
    <path d="M113.5 4.62817H111.104V18.6217H113.5V4.62817Z" fill="currentColor"/>
    <path d="M117.589 12.8154L121.517 18.6208H118.554L114.625 12.8154L118.554 8.15088H121.517L117.589 12.8154Z" fill="currentColor"/>
    <g clipPath="url(#dsh-sv-whale-clip)">
      <path d="M23.0584 4.95203C22.8129 4.83203 22.7074 5.06103 22.5639 5.17704C22.5149 5.21454 22.4734 5.26354 22.4319 5.30854C22.0734 5.69155 21.6543 5.94306 21.1073 5.91306C20.3073 5.86806 19.6243 6.11957 19.0203 6.73158C18.8918 5.97706 18.4652 5.52655 17.8162 5.23754C17.4767 5.08753 17.1332 4.93703 16.8952 4.61052C16.7292 4.37801 16.6837 4.11901 16.6007 3.8635C16.5477 3.70949 16.4952 3.55199 16.3177 3.52549C16.1252 3.49549 16.0497 3.65699 15.9742 3.792C15.6722 4.34401 15.5552 4.95203 15.5667 5.56805C15.5932 6.95359 16.1782 8.05712 17.3407 8.84215C17.4727 8.93215 17.5067 9.02215 17.4652 9.15366C17.3857 9.42416 17.2917 9.68667 17.2087 9.95718C17.1557 10.1297 17.0767 10.1677 16.8917 10.0922C16.2537 9.82568 15.7027 9.43117 15.2156 8.95465C14.3891 8.15513 13.6416 7.2726 12.7096 6.58158C12.4906 6.42007 12.2716 6.27007 12.045 6.12707C11.094 5.20354 12.1696 4.44502 12.4186 4.35501C12.6791 4.26101 12.5091 3.938 11.6675 3.942C10.826 3.9455 10.056 4.22751 9.07446 4.60302C8.93096 4.65952 8.77995 4.70052 8.62545 4.73452C7.73492 4.56552 6.80989 4.52802 5.84386 4.63702C4.02481 4.83953 2.57177 5.69955 1.50373 7.1676C0.220694 8.93215 -0.0813148 10.9372 0.288196 13.0283C0.676708 15.2323 1.80174 17.0569 3.53029 18.4834C5.32285 19.9625 7.38741 20.6875 9.74298 20.5485C11.1735 20.466 12.7661 20.2745 14.5626 18.7539C15.0156 18.9795 15.4912 19.0695 16.2797 19.137C16.8872 19.1935 17.4722 19.107 17.9252 19.013C18.6347 18.8629 18.5857 18.2059 18.3292 18.0854C16.2497 17.1169 16.7062 17.5109 16.2912 17.1919C17.3477 15.9419 18.9618 13.7198 19.4598 10.6942C19.5088 10.3602 19.5713 9.88968 19.5638 9.61917C19.5598 9.45417 19.5978 9.39016 19.7863 9.37116C20.3073 9.31116 20.8128 9.16866 21.2773 8.91315C22.6249 8.17713 23.1684 6.96809 23.2964 5.51905C23.3154 5.29754 23.2924 5.06853 23.0584 4.95203ZM11.3165 17.9954C9.30097 16.4109 8.32344 15.8894 7.91992 15.9119C7.54241 15.9344 7.61042 16.3664 7.69342 16.6479C7.78042 16.9259 7.89342 17.1174 8.05193 17.3614C8.16143 17.5229 8.23694 17.7629 7.94243 17.9434C7.29341 18.3449 6.16487 17.8084 6.11187 17.7819C4.79833 17.0084 3.7003 15.9874 2.92628 14.5908C2.17875 13.2468 1.74474 11.8047 1.67324 10.2657C1.65424 9.89418 1.76374 9.76267 2.13375 9.69517C2.62077 9.60517 3.12278 9.58617 3.6093 9.65767C5.66636 9.95818 7.41741 10.8777 8.88545 12.3348C9.72348 13.1643 10.3575 14.1558 11.0105 15.1243C11.705 16.1529 12.4521 17.1329 13.4036 17.9364C13.7396 18.2179 14.0076 18.4319 14.2641 18.5899C13.4906 18.6764 12.1996 18.6949 11.3165 17.9964V17.9954ZM12.2826 11.7817C12.2826 11.6167 12.4146 11.4852 12.5806 11.4852C12.6181 11.4852 12.6521 11.4927 12.6826 11.5037C12.7241 11.5187 12.7621 11.5412 12.7921 11.5752C12.8451 11.6277 12.8751 11.7027 12.8751 11.7817C12.8751 11.9467 12.7431 12.0782 12.5771 12.0782C12.4111 12.0782 12.2826 11.9467 12.2826 11.7817ZM15.2831 13.3208C15.0906 13.3998 14.8981 13.4673 14.7131 13.4748C14.4261 13.4898 14.1131 13.3733 13.9431 13.2308C13.6791 13.0093 13.4901 12.8853 13.4111 12.4988C13.3771 12.3338 13.3961 12.0782 13.4261 11.9317C13.4941 11.6162 13.4186 11.4137 13.1961 11.2297C13.0151 11.0797 12.7846 11.0382 12.5316 11.0382C12.4371 11.0382 12.3506 10.9967 12.2861 10.9632C12.1806 10.9107 12.0936 10.7792 12.1766 10.6177C12.2031 10.5652 12.3316 10.4377 12.3616 10.4152C12.7051 10.2197 13.1011 10.2837 13.4676 10.4302C13.8071 10.5692 14.0641 10.8242 14.4336 11.1847C14.8111 11.6202 14.8791 11.7402 15.0941 12.0672C15.2641 12.3228 15.4186 12.5853 15.5247 12.8858C15.5887 13.0733 15.5057 13.2268 15.2831 13.3208Z" fill="currentColor"/>
    </g>
    <rect x="129.348" y="5.5" width="52" height="14" rx="2" fill="currentColor"/>
    <g clipPath="url(#dsh-sv-badge-clip)">
      <path d="M132.848 8.93205H134.08V16.137H132.848V8.93205ZM136.5 8.93205H137.732V16.137H136.5V8.93205ZM133.365 13.024V11.99H137.193V13.024H133.365Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M140.397 14.432L140.672 13.453H143.202L143.532 14.432H140.397ZM140.287 16.137H139.055L141.277 8.93205H142.201L142.146 9.74605L140.947 13.915H140.969L140.287 16.137ZM145.039 16.137H143.741L143.07 13.948L143.081 13.937L141.871 9.74605L141.926 8.93205H142.817L145.039 16.137Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M146.846 8.93205H149.068C149.852 8.93205 150.443 9.11538 150.839 9.48205C151.235 9.84138 151.433 10.3327 151.433 10.956C151.433 11.22 151.396 11.4657 151.323 11.693C151.249 11.9204 151.125 12.1257 150.949 12.309C150.773 12.4924 150.531 12.65 150.223 12.782C149.922 12.9067 149.541 13.0057 149.079 13.079V13.321H146.846V12.639L148.023 12.485C148.631 12.4044 149.09 12.298 149.398 12.166C149.706 12.034 149.915 11.8764 150.025 11.693C150.135 11.5024 150.19 11.2934 150.19 11.066C150.19 10.6994 150.083 10.417 149.871 10.219C149.658 10.021 149.324 9.92205 148.87 9.92205H146.846V8.93205ZM146.395 8.93205H147.627V16.137H146.395V8.93205ZM151.917 16.093V16.137H150.366L149.024 14.322C148.87 14.1094 148.73 13.9407 148.606 13.816C148.481 13.684 148.345 13.5887 148.199 13.53C148.052 13.464 147.872 13.42 147.66 13.398C147.447 13.3687 147.176 13.3504 146.846 13.343V13.145H149.079C149.233 13.211 149.368 13.2844 149.486 13.365C149.61 13.4457 149.735 13.5447 149.86 13.662C149.992 13.7794 150.138 13.937 150.3 14.135L151.917 16.093Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M153.58 9.57005L153.591 8.93205H154.46L157.584 15.51V16.137H156.704L153.58 9.57005ZM158.024 16.137H156.968L156.88 8.93205H158.024V16.137ZM154.24 16.137H153.096V8.93205H154.152L154.24 16.137Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M159.963 8.93205H161.206V16.137H159.963V8.93205ZM160.095 9.96605V8.93205H164.858V9.96605H160.095ZM160.095 16.137V15.103H164.902V16.137H160.095ZM160.095 13.013V11.99H164.374V13.013H160.095Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M169.052 15.257C169.543 15.257 169.895 15.1654 170.108 14.982C170.328 14.7987 170.438 14.5457 170.438 14.223C170.438 14.047 170.405 13.8967 170.339 13.772C170.273 13.6474 170.152 13.5337 169.976 13.431C169.807 13.321 169.558 13.2147 169.228 13.112L168.491 12.881C167.846 12.6757 167.38 12.4044 167.094 12.067C166.808 11.7297 166.665 11.3007 166.665 10.78C166.665 10.428 166.76 10.1017 166.951 9.80105C167.142 9.50038 167.428 9.25838 167.809 9.07505C168.19 8.89172 168.663 8.80005 169.228 8.80005C169.631 8.80005 169.998 8.82938 170.328 8.88805C170.665 8.93938 171.039 9.01638 171.45 9.11905L171.274 10.175C170.834 10.0504 170.442 9.96238 170.097 9.91105C169.76 9.85238 169.463 9.82305 169.206 9.82305C168.737 9.82305 168.403 9.90738 168.205 10.076C168.007 10.2374 167.908 10.439 167.908 10.681C167.908 10.857 167.941 11.0147 168.007 11.154C168.073 11.286 168.19 11.407 168.359 11.517C168.535 11.627 168.784 11.7334 169.107 11.836L169.866 12.078C170.526 12.276 170.995 12.5327 171.274 12.848C171.553 13.156 171.692 13.585 171.692 14.135C171.692 14.5604 171.589 14.9344 171.384 15.257C171.179 15.5797 170.878 15.8327 170.482 16.016C170.093 16.1994 169.609 16.291 169.03 16.291C168.627 16.291 168.212 16.247 167.787 16.159C167.362 16.071 166.9 15.9427 166.401 15.774L166.665 14.718C167.156 14.894 167.6 15.0297 167.996 15.125C168.399 15.213 168.751 15.257 169.052 15.257Z" fill="var(--dsw-alias-label-primary-inverted)"/>
      <path d="M175.809 15.257C176.3 15.257 176.652 15.1654 176.865 14.982C177.085 14.7987 177.195 14.5457 177.195 14.223C177.195 14.047 177.162 13.8967 177.096 13.772C177.03 13.6474 176.909 13.5337 176.733 13.431C176.564 13.321 176.315 13.2147 175.985 13.112L175.248 12.881C174.603 12.6757 174.137 12.4044 173.851 12.067C173.565 11.7297 173.422 11.3007 173.422 10.78C173.422 10.428 173.517 10.1017 173.708 9.80105C173.899 9.50038 174.185 9.25838 174.566 9.07505C174.947 8.89172 175.42 8.80005 175.985 8.80005C176.388 8.80005 176.755 8.82938 177.085 8.88805C177.422 8.93938 177.796 9.01638 178.207 9.11905L178.031 10.175C177.591 10.0504 177.199 9.96238 176.854 9.91105C176.517 9.85238 176.22 9.82305 175.963 9.82305C175.494 9.82305 175.16 9.90738 174.962 10.076C174.764 10.2374 174.665 10.439 174.665 10.681C174.665 10.857 174.698 11.0147 174.764 11.154C174.83 11.286 174.947 11.407 175.116 11.517C175.292 11.627 175.541 11.7334 175.864 11.836L176.623 12.078C177.283 12.276 177.752 12.5327 178.031 12.848C178.31 13.156 178.449 13.585 178.449 14.135C178.449 14.5604 178.346 14.9344 178.141 15.257C177.936 15.5797 177.635 15.8327 177.239 16.016C176.85 16.1994 176.366 16.291 175.787 16.291C175.384 16.291 174.969 16.247 174.544 16.159C174.119 16.071 173.657 15.9427 173.158 15.774L173.422 14.718C173.913 14.894 174.357 15.0297 174.753 15.125C175.156 15.213 175.508 15.257 175.809 15.257Z" fill="var(--dsw-alias-label-primary-inverted)"/>
    </g>
    <defs>
      <clipPath id="dsh-sv-whale-clip">
        <rect width="23.16" height="17.0435" fill="white" transform="translate(0.141602 3.52185)"/>
      </clipPath>
      <clipPath id="dsh-sv-badge-clip">
        <rect width="46" height="14" fill="white" transform="translate(132.348 5.5)"/>
      </clipPath>
    </defs>
  </svg>
);

/* ---- 数据模型:与上游 workspace store 同 wire(session.list + workspace.list RPC) ---- */
interface SessionItem {
  sessionId: string;
  updatedAt: number;
  blank: boolean;
  running: boolean;
  /** 会话来源:'main' | 'subagent' 等;子代理会话按上游 sessionVisible 语义隐藏于顶层。 */
  origin?: string;
  parentSessionId?: string;
  title: string;
}

interface WorkspaceItem {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
}

/** 一行会话的视图模型(渲染所需字段全量铺平;children = 子代理子代,递归)。 */
interface SessionRow {
  sessionId: string;
  title: string;
  blank: boolean;
  running: boolean;
  updatedAt: number;
  archived: boolean;
  children: SessionRow[];
}

interface SessionSection {
  key: string;
  kind: 'workspace' | 'unassigned' | 'archived';
  label: string;
  cwd?: string;
  rows: SessionRow[];
}

const UNASSIGNED_KEY = '__unassigned__';
const ARCHIVED_KEY = '__archived__';

/** 分组视图模型:workspace 段(workspace.list.sessionIds 反向索引)→ 未分组 → 已归档。
 * 归档/子代理/非当前 blank 按上游 sessionVisible 语义从 workspace/未分组隐藏;
 * origin==='subagent' 的会话按 parentSessionId 挂在父行下(递归);父不可见时提升为顶层;
 * 归档会话(含子代理)单独进"已归档"段(默认折叠)。fork 子代(parentSessionId 非空但
 * origin 非 subagent)维持上游语义 = 普通顶层行,不嵌套。 */
function buildSessionPageModel(
  sessions: SessionItem[],
  workspaces: WorkspaceItem[],
  archivedSessionIds: readonly string[],
  currentId: string | undefined,
): SessionSection[] {
  const archived = new Set(archivedSessionIds);
  const byId = new Map<string, SessionItem>();
  for (const s of sessions) byId.set(s.sessionId, s);
  const visible = (s: SessionItem): boolean =>
    s.origin !== 'subagent' && !archived.has(s.sessionId) && (!s.blank || s.sessionId === currentId);
  // 子代理 → 父 索引(仅 origin==='subagent',排除已归档;递归由 toRow 处理)
  const childrenByParent = new Map<string, SessionItem[]>();
  for (const s of sessions) {
    if (s.origin !== 'subagent' || archived.has(s.sessionId)) continue;
    if (typeof s.parentSessionId !== 'string' || s.parentSessionId === '') continue;
    const arr = childrenByParent.get(s.parentSessionId) ?? [];
    arr.push(s);
    childrenByParent.set(s.parentSessionId, arr);
  }
  const toRow = (s: SessionItem, seen: Set<string>): SessionRow => {
    const row: SessionRow = {
      sessionId: s.sessionId,
      title: s.title,
      blank: s.blank,
      running: s.running,
      updatedAt: s.updatedAt,
      archived: archived.has(s.sessionId),
      children: [],
    };
    if (seen.has(s.sessionId)) return row; // 环保护(数据异常时避免死循环)
    seen.add(s.sessionId);
    const kids = (childrenByParent.get(s.sessionId) ?? [])
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    row.children = kids.map((k) => toRow(k, seen));
    return row;
  };
  const byRecency = (a: SessionRow, b: SessionRow): number => b.updatedAt - a.updatedAt;
  const attached = new Set<string>();
  const noteAttached = (rows: SessionRow[]): void => {
    for (const r of rows) {
      attached.add(r.sessionId);
      noteAttached(r.children);
    }
  };
  const sections: SessionSection[] = [];
  for (const w of workspaces) {
    const rows = w.sessionIds
      .map((id) => byId.get(id))
      .filter((s): s is SessionItem => s !== undefined && visible(s))
      .map((s) => toRow(s, new Set()))
      .sort(byRecency);
    if (rows.length === 0) continue;
    noteAttached(rows);
    sections.push({ key: w.workspaceId, kind: 'workspace', label: w.title, cwd: w.path, rows });
  }
  const inWorkspace = new Set<string>();
  for (const w of workspaces) for (const id of w.sessionIds) inWorkspace.add(id);
  const unassigned = sessions
    .filter((s) => visible(s) && !inWorkspace.has(s.sessionId))
    .map((s) => toRow(s, new Set()))
    .sort(byRecency);
  // 父不可见的子代理(父被归档/隐藏/不在列表)→ 提升为顶层,避免会话"丢失"
  const promoted = sessions
    .filter((s) => s.origin === 'subagent' && !archived.has(s.sessionId) && !attached.has(s.sessionId))
    .map((s) => toRow(s, new Set()))
    .sort(byRecency);
  const unassignedAll = [...unassigned, ...promoted].sort(byRecency);
  if (unassignedAll.length > 0) {
    noteAttached(unassignedAll);
    sections.push({ key: UNASSIGNED_KEY, kind: 'unassigned', label: str('未分组', 'Ungrouped'), rows: unassignedAll });
  }
  const archivedRows = sessions
    .filter((s) => archived.has(s.sessionId))
    .map((s) => toRow(s, new Set()))
    .sort(byRecency);
  if (archivedRows.length > 0) {
    sections.push({ key: ARCHIVED_KEY, kind: 'archived', label: str('已归档', 'Archived'), rows: archivedRows });
  }
  return sections;
}

/* ---- 相对时间:上游 relativeTime 桶语义(刚刚/{n}分钟/{n}小时/{n}天/{n}个月/{n}年) ---- */
function relativeTime(updatedAt: number, now: number): { unit: string; n: number } {
  const diff = Math.max(0, now - updatedAt);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return { unit: 'now', n: 0 };
  const hr = Math.floor(min / 60);
  if (hr < 1) return { unit: 'minutes', n: min };
  const day = Math.floor(hr / 24);
  if (day < 1) return { unit: 'hours', n: hr };
  const mon = Math.floor(day / 30);
  if (mon < 1) return { unit: 'days', n: day };
  const yr = Math.floor(mon / 12);
  if (yr < 1) return { unit: 'months', n: mon };
  return { unit: 'years', n: yr };
}

const TIME_LABELS: Record<string, [string, string]> = {
  now: ['刚刚', 'now'],
  minutes: ['{n}分钟', '{n}min'],
  hours: ['{n}小时', '{n}h'],
  days: ['{n}天', '{n}d'],
  months: ['{n}个月', '{n}mo'],
  years: ['{n}年', '{n}y'],
};

function timeLabel(updatedAt: number, now: number): string {
  const { unit, n } = relativeTime(updatedAt, now);
  const [zh, en] = TIME_LABELS[unit] ?? ['', ''];
  return str(zh.replace('{n}', String(n)), en.replace('{n}', String(n)));
}

function parseSession(it: unknown): SessionItem | undefined {
  const item = it as {
    sessionId?: string;
    updatedAt?: number;
    blank?: boolean;
    running?: boolean;
    origin?: string;
    parentSessionId?: string;
    projections?: { values?: { title?: string } };
  };
  if (typeof item.sessionId !== 'string' || item.sessionId === '') return undefined;
  return {
    sessionId: item.sessionId,
    updatedAt: item.updatedAt ?? 0,
    blank: item.blank === true,
    running: item.running === true,
    origin: typeof item.origin === 'string' ? item.origin : undefined,
    parentSessionId: typeof item.parentSessionId === 'string' ? item.parentSessionId : undefined,
    title: item.blank ? '' : (item.projections?.values?.title ?? ''),
  };
}

function parseWorkspace(it: unknown): WorkspaceItem | undefined {
  const item = it as { workspaceId?: string; path?: string; title?: string; sessionIds?: unknown };
  if (typeof item.workspaceId !== 'string' || item.workspaceId === '') return undefined;
  const sessionIds = Array.isArray(item.sessionIds)
    ? item.sessionIds.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    workspaceId: item.workspaceId,
    path: typeof item.path === 'string' ? item.path : '',
    title: typeof item.title === 'string' && item.title !== '' ? item.title : item.workspaceId,
    sessionIds,
  };
}

function useSessionsModel(currentId: string | undefined): {
  sections: SessionSection[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [sections, setSections] = useState<SessionSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([rpc('session.list', {}), rpc('workspace.list', {})])
      .then(([sl, wl]) => {
        if (cancelled) return;
        const sValue = (sl as { result?: { value?: { items?: unknown[] } } }).result?.value;
        const sessions = Array.isArray(sValue?.items)
          ? sValue.items.map(parseSession).filter((it): it is SessionItem => it !== undefined)
          : [];
        const wValue = (wl as { result?: { value?: { items?: unknown[]; archivedSessionIds?: unknown } } }).result?.value;
        const workspaces = Array.isArray(wValue?.items)
          ? wValue.items.map(parseWorkspace).filter((it): it is WorkspaceItem => it !== undefined)
          : [];
        const archived = Array.isArray(wValue?.archivedSessionIds)
          ? wValue.archivedSessionIds.filter((x): x is string => typeof x === 'string')
          : [];
        setSections(buildSessionPageModel(sessions, workspaces, archived, currentId));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick, currentId]);

  // 切回本页(bridge 派发 dsh:view = sessions)时自动刷新
  useEffect(() => {
    const onView = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === 'sessions') reload();
    };
    window.addEventListener('dsh:view', onView);
    return () => window.removeEventListener('dsh:view', onView);
  }, [reload]);

  return { sections, loading, error, reload };
}

/** 跳转打开会话:写上游恢复键 → 回传 applied → 扩展重载 webview → boot 进入该会话。 */
const openSession = (sessionId: string): void => {
  try {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }));
    localStorage.setItem('dsh.ui.view', 'chat');
  } catch {
    /* localStorage 不可用(隐私模式)时仍尝试跳转 */
  }
  postToHost({ type: 'switch-session:applied', sessionId });
};

/** 当前会话(高亮):dsh.sessions.current(与上游恢复键同源)。
 * 只在挂载时读一次:打开会话后整页重载,本页不跨会话存活。 */
function useCurrentSessionId(): string | undefined {
  const [id] = useState<string | undefined>(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current');
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw) as { sessionId?: unknown };
      return typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;
    } catch {
      return undefined;
    }
  });
  return id;
}

/** 页头:仅居中品牌 wordmark(无返回键,2026-08 用户要求)。 */
function SessionPageHeader(): React.JSX.Element {
  return (
    <header className="dsh-session-header">
      <BrandWordmark />
    </header>
  );
}

/** 底部独立一行:新建会话按钮。配色:未激活 = 白底 + 强调色边 + 强调色字;
 * 激活(hover/按下)= 强调色底 + 白字(用户要求)。 */
function SessionNewRow({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <footer className="dsh-session-footer">
      <button type="button" className="dsh-session-new" onClick={onNew}>
        <PlusIcon />
        <span>{str('新建会话', 'New session')}</span>
      </button>
    </footer>
  );
}

function SessionSectionHeader({
  section,
  expanded,
  onToggle,
}: {
  section: SessionSection;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="dsh-session-section-head"
      onClick={onToggle}
      aria-expanded={expanded}
      title={section.kind === 'workspace' ? section.cwd : undefined}
    >
      <span className={'dsh-session-section-arrow' + (expanded ? ' dsh-session-section-arrow--open' : '')}>
        <TriangleRightIcon />
      </span>
      {section.kind === 'workspace' && (
        <span className="dsh-session-section-folder">
          {expanded ? <FolderOpenIcon /> : <FolderCloseIcon />}
        </span>
      )}
      <span className="dsh-session-section-title">{section.label}</span>
      <span className="dsh-session-section-count">{section.rows.length}</span>
    </button>
  );
}

function SessionRowView({
  row,
  currentId,
  collapsedRows,
  onToggleChildren,
  onOpen,
  onMenu,
}: {
  row: SessionRow;
  currentId: string | undefined;
  collapsedRows: Record<string, boolean>;
  onToggleChildren: (sessionId: string) => void;
  onOpen: (sessionId: string) => void;
  onMenu: (row: SessionRow, x: number, y: number) => void;
}): React.JSX.Element {
  const hasChildren = row.children.length > 0;
  const expanded = !collapsedRows[row.sessionId];
  const rowCls =
    'dsh-session-row' +
    (row.sessionId === currentId ? ' dsh-session-row--current' : '') +
    (row.archived ? ' dsh-session-row--muted' : '');
  return (
    <div className="dsh-session-row-wrap">
      <div className="dsh-session-row-line">
        <button type="button" className={rowCls} onClick={() => onOpen(row.sessionId)}>
          <span className="dsh-session-dot-slot">
            {row.running && <span className="dsh-session-dot" aria-hidden="true" />}
          </span>
          <span className="dsh-session-title-group">
            <span className="dsh-session-title">{row.title !== '' ? row.title : str('新会话', 'New session')}</span>
            {hasChildren && (
              <span
                className={'dsh-session-inline-chevron' + (expanded ? ' dsh-session-inline-chevron--open' : '')}
                aria-hidden="true"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleChildren(row.sessionId);
                }}
              >
                <TriangleRightIcon />
              </span>
            )}
          </span>
          <span className="dsh-session-meta">
            {row.running && <span className="dsh-session-status">{str('进行中', 'Running')}</span>}
            {!row.blank && <span className="dsh-session-time">{timeLabel(row.updatedAt, Date.now())}</span>}
          </span>
        </button>
        <button
          type="button"
          className="dsh-session-more"
          aria-label={str('会话操作', 'Session actions')}
          onClick={(event) => {
            event.stopPropagation();
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            onMenu(row, Math.max(8, rect.right - 168), Math.min(rect.bottom + 4, window.innerHeight - 130));
          }}
        >
          <EllipsisIcon />
        </button>
      </div>
      {hasChildren && expanded && (
        <div className="dsh-session-children">
          {row.children.map((child) => (
            <SessionRowView
              key={child.sessionId}
              row={child}
              currentId={currentId}
              collapsedRows={collapsedRows}
              onToggleChildren={onToggleChildren}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 行操作菜单(⋯):重命名 / 分叉 / 归档。自绘(overlay 点击外部 + Escape 关闭 + ARIA),
 * 不依赖 vendor Menu(只读约束)。 */
function SessionMenu({
  x,
  y,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  onAction: (action: 'rename' | 'fork' | 'archive') => void;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="dsh-menu-overlay" onClick={onClose} />
      <div
        className="dsh-session-menu"
        style={{ left: x, top: y }}
        role="menu"
        aria-label={str('会话操作', 'Session actions')}
      >
        <button type="button" role="menuitem" onClick={() => onAction('rename')}>
          <EditIcon />
          <span>{str('重命名', 'Rename')}</span>
        </button>
        <button type="button" role="menuitem" onClick={() => onAction('fork')}>
          <BranchIcon />
          <span>{str('分叉会话', 'Fork session')}</span>
        </button>
        <button type="button" role="menuitem" onClick={() => onAction('archive')}>
          <ArchiveIcon />
          <span>{str('归档会话', 'Archive session')}</span>
        </button>
      </div>
    </>
  );
}

/** 重命名对话框(Modal):输入 + Enter/Escape + 保存/取消。 */
function RenameDialog({
  row,
  onCancel,
  onSave,
}: {
  row: SessionRow;
  onCancel: () => void;
  onSave: (title: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(row.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const trimmed = value.trim();
  return (
    <div className="dsh-session-dialog-overlay">
      <div className="dsh-session-dialog" role="dialog" aria-label={str('重命名会话', 'Rename session')}>
        <div className="dsh-session-dialog-title">{str('重命名会话', 'Rename session')}</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (trimmed !== '') onSave(trimmed);
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          aria-label={str('会话标题', 'Session title')}
        />
        <div className="dsh-session-dialog-actions">
          <button type="button" className="dsh-session-dialog-cancel" onClick={onCancel}>
            {str('取消', 'Cancel')}
          </button>
          <button
            type="button"
            className="dsh-session-dialog-ok"
            disabled={trimmed === ''}
            onClick={() => { if (trimmed !== '') onSave(trimmed); }}
          >
            {str('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionManagementView(): React.JSX.Element {
  const currentId = useCurrentSessionId();
  const { sections, loading, error, reload } = useSessionsModel(currentId);
  // 段折叠:默认 workspace/未分组展开,已归档折叠;行折叠:子代理默认展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({ [ARCHIVED_KEY]: true }));
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>(() => ({}));
  const [menuFor, setMenuFor] = useState<{ row: SessionRow; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<SessionRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toggle = (key: string): void => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const toggleChildren = (sessionId: string): void =>
    setCollapsedRows((c) => ({ ...c, [sessionId]: !c[sessionId] }));

  // 扩展 error 消息(如 dsh:new-session 的 ensureFolderSession 失败)→ 横幅,不再静默
  useEffect(() => {
    const onMsg = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; message?: unknown } | null;
      if (data !== null && typeof data === 'object' && data.type === 'error' && typeof data.message === 'string') {
        setActionError(data.message);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const runAction = async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const onMenuAction = (action: 'rename' | 'fork' | 'archive'): void => {
    const row = menuFor?.row;
    setMenuFor(null);
    if (row === undefined) return;
    if (action === 'rename') {
      setRenaming(row);
      return;
    }
    void runAction(async () => {
      if (action === 'fork') {
        await rpc('session.fork', { sessionId: row.sessionId });
      } else {
        await rpc('workspace.archiveSession', { sessionId: row.sessionId });
      }
      reload();
    });
  };

  const onRenameSave = (title: string): void => {
    const row = renaming;
    setRenaming(null);
    if (row === null) return;
    void runAction(async () => {
      await rpc('session.rename', { sessionId: row.sessionId, title });
      reload();
    });
  };

  return (
    <div className="dsh-session-page">
      <SessionPageHeader />
      {actionError !== null && <div className="dsh-session-error-banner">{actionError}</div>}
      <main className="dsh-session-body">
        {loading ? (
          <div className="dsh-session-state">{str('加载中…', 'Loading…')}</div>
        ) : error !== null ? (
          <div className="dsh-session-state">
            <div>{str('会话加载失败', 'Failed to load sessions')}</div>
            <div className="dsh-session-error">{error}</div>
            <button type="button" className="dsh-session-retry" onClick={reload}>
              {str('重试', 'Retry')}
            </button>
          </div>
        ) : sections.length === 0 ? (
          <div className="dsh-session-state">{str('暂无会话', 'No sessions')}</div>
        ) : (
          <div className="dsh-session-sections">
            {sections.map((section) => (
              <section key={section.key} className="dsh-session-section">
                <SessionSectionHeader
                  section={section}
                  expanded={!collapsed[section.key]}
                  onToggle={() => toggle(section.key)}
                />
                {!collapsed[section.key] && (
                  <div className="dsh-session-rows">
                    {section.rows.map((row) => (
                      <SessionRowView
                        key={row.sessionId}
                        row={row}
                        currentId={currentId}
                        collapsedRows={collapsedRows}
                        onToggleChildren={toggleChildren}
                        onOpen={openSession}
                        onMenu={(r, x, y) => setMenuFor({ row: r, x, y })}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
      <SessionNewRow onNew={() => postToHost({ type: 'dsh:new-session' })} />
      {menuFor !== null && (
        <SessionMenu x={menuFor.x} y={menuFor.y} onAction={onMenuAction} onClose={() => setMenuFor(null)} />
      )}
      {renaming !== null && (
        <RenameDialog row={renaming} onCancel={() => setRenaming(null)} onSave={onRenameSave} />
      )}
    </div>
  );
}
