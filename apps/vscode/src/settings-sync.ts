/**
 * settings-sync.ts — VS Code 设置 ↔ dsh web(3080)设置双向同步。
 *
 * 原则:
 * - 默认 follow-web:语言/主题跟随 dsh web UI 当前设置(读方向,不写回)
 * - 用户选具体值(zh/en/light/dark/system):写回 dsh 实例 settings(locale/theme 命名空间),
 *   上游 webview 插件监听 settings 事件自动生效
 * - 只经 HTTP POST /api/settings.{describe,mutate},走既有 RPC 信封
 */

import * as vscode from 'vscode';
import { postRpc } from './rpc.js';

/** dsh settings 命名空间内的偏好字段(与上游 locale/theme 插件约定一致) */
const LOCALE_NS = 'locale';
const THEME_NS = 'ui-theme';
const PREFERENCE_FIELD = 'preference';

/** VS Code 设置读到的可选值 */
export type LocaleSetting = 'follow-web' | 'zh' | 'en';
export type ThemeSetting = 'follow-web' | 'light' | 'dark' | 'system';
/** 权限三档(112GT 模式;与 dsh permission 命名空间的 preset 名一致) */
export type PermissionSetting = 'read-only' | 'workspace-write' | 'danger-full-access';

/** 从 3080 读 settings.describe,返回当前生效的 locale/theme 偏好 */
export async function readWebPreferences(baseUrl: string): Promise<{ locale?: string; theme?: string }> {
  try {
    const body = await postRpc(baseUrl, 'settings.describe', {});
    const value = body?.result?.value as
      | { namespaces?: Array<{ ns: string; value?: Record<string, unknown> }> }
      | undefined;
    const namespaces = value?.namespaces;
    if (!Array.isArray(namespaces)) return {};
    const pick = (ns: string) => namespaces.find((n) => n.ns === ns)?.value?.[PREFERENCE_FIELD];
    return { locale: pick(LOCALE_NS) as string | undefined, theme: pick(THEME_NS) as string | undefined };
  } catch {
    // 实例不可达:保持 follow-web 语义(webview 端上游插件自行兜底)
    return {};
  }
}

/** 把 VS Code 设置写回 dsh 实例(仅具体值;follow-web 不写回) */
export async function writeWebPreference(
  baseUrl: string,
  ns: string,
  value: string,
): Promise<boolean> {
  try {
    const body = await postRpc(baseUrl, 'settings.mutate', {
      ns,
      ops: [{ op: 'set', path: [PREFERENCE_FIELD], value }],
    });
    return body?.result?.ok === true;
  } catch {
    return false;
  }
}

/** settings 双向同步注册(theme + locale 独立监听,便于按项报告) */
export function registerSettingsSync(baseUrl: () => string): vscode.Disposable[] {
  const themeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('deepseekHarness.theme')) return;
    const v = cfgTheme();
    if (v === 'follow-web') return;
    void writeWebPreference(baseUrl(), THEME_NS, v).then((ok) => {
      if (!ok) void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(theme=${v}),请确认实例在线`);
    });
  });
  const localeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('deepseekHarness.locale')) return;
    const v = cfgLocale();
    if (v === 'follow-web') return;
    void writeWebPreference(baseUrl(), LOCALE_NS, v).then((ok) => {
      if (!ok) void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(locale=${v}),请确认实例在线`);
    });
  });
  return [themeDisposable, localeDisposable];
}

function cfgLocale(): LocaleSetting {
  return vscode.workspace.getConfiguration('deepseekHarness').get<LocaleSetting>('locale', 'follow-web');
}

function cfgTheme(): ThemeSetting {
  return vscode.workspace.getConfiguration('deepseekHarness').get<ThemeSetting>('theme', 'follow-web');
}

// ---- P1-2:权限模式三档(read-only / workspace-write / danger-full-access) ----
// 与 dsh `permission.defaultPreset`(实测 preset 名一致)双向同步;
// running 时禁止切换;danger 需 modal 确认,取消则回滚设置。

const PERMISSION_NS = 'permission';
const DEFAULT_PRESET_FIELD = 'defaultPreset';

function cfgPermission(): PermissionSetting {
  return vscode.workspace
    .getConfiguration('deepseekHarness')
    .get<PermissionSetting>('permissionMode', 'workspace-write');
}

export function registerPermissionSync(baseUrl: () => string, isRunning: () => boolean): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (!e.affectsConfiguration('deepseekHarness.permissionMode')) return;
    const next = cfgPermission();
    if (isRunning()) {
      // running 保护(112GT):当前回合结束前禁止切换
      void vscode.window.showWarningMessage('dsh: 请等待当前回合结束再切换权限模式');
      return;
    }
    if (next === 'danger-full-access') {
      const choice = await vscode.window.showWarningMessage(
        '危险权限:允许 Harness 工具访问工作区外文件,且无逐项审批。',
        { modal: true },
        '确认使用',
      );
      if (choice !== '确认使用') {
        // 取消 → 回滚设置为 workspace-write(danger 需显式确认)
        await vscode.workspace.getConfiguration('deepseekHarness').update('permissionMode', 'workspace-write', true);
        return;
      }
    }
    const ok = await writeWebPreference(baseUrl(), PERMISSION_NS, next);
    if (!ok) {
      void vscode.window.showWarningMessage(`dsh: 无法写回实例权限设置(permissionMode=${next}),请确认实例在线`);
    }
  });
}
