/**
 * settings-bridge.ts — VS Code 设置 ↔ dsh 实例(3080)设置双向同步(Phase 9)。
 *
 * 映射表(一一对应,真实可改):
 *   deepseekHarness.theme           → settings ns `ui-theme`        field `preference`(light/dark/system)
 *   deepseekHarness.locale          → settings ns `locale`          field `preference`(zh/en)
 *   deepseekHarness.permissionMode  → settings ns `permission`      field `defaultPreset`(read-only/workspace-write/danger-full-access)
 *   deepseekHarness.agentPreset     → settings ns `agent-presets`   field `default`(preset id,如 code/standard/minimal/cordis)
 *   deepseekHarness.busyEnter       → settings ns `ui-conversation` field `busyEnter`(queue/steer)
 *
 * 方向:
 * - 推(VS Code → 实例):onDidChangeConfiguration 触发,经 settings.update 写回;
 *   locale/theme 仅具体值写回(follow-web 不写);permission 带 running 保护 + danger 确认。
 * - 拉(实例 → VS Code):webview 可见时每 5s 轮询 settings.describe,值漂移则回写 VS Code
 *   设置(抑制标志防回环:回写触发的 change 事件不再推实例)。
 * 写回统一走 settings.update({ns, patch})(上游 store 同款信封),替代旧的 settings.mutate。
 *
 * M6.3: 所有 RPC 调用改用 DshWebApiClient.callMethod()。
 */

import * as vscode from 'vscode';
import { DshWebApiClient } from './api/dsh-web-api-client.js';

/** 实例 settings 命名空间与字段(与上游各插件约定一致,实测 3080) */
const THEME_NS = 'ui-theme';
const LOCALE_NS = 'locale';
const PERMISSION_NS = 'permission';
const AGENT_PRESET_NS = 'agent-presets';
const CONVERSATION_NS = 'ui-conversation';

export type LocaleSetting = 'follow-web' | 'zh' | 'en';
export type ThemeSetting = 'follow-web' | 'light' | 'dark' | 'system';
export type PermissionSetting = 'read-only' | 'workspace-write' | 'danger-full-access';
export type BusyEnterSetting = 'queue' | 'steer';

/** settings.update 写一个字段;网络/实例错误返回失败信息(调用方提示) */
export async function writeSettingField(
  api: DshWebApiClient,
  ns: string,
  field: string,
  value: string,
): Promise<string | undefined> {
  try {
    const resp = await api.callMethod<{ ok?: boolean; error?: { message?: string } }>(
      'settings.update',
      { ns, patch: { [field]: value } },
    );
    if (resp.result.ok === true) return undefined;
    return resp.result.error?.message ?? '实例拒绝该设置';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** settings.describe 当前生效值(某命名空间某字段);失败 undefined */
async function readSettingField(
  api: DshWebApiClient,
  ns: string,
  field: string,
): Promise<string | undefined> {
  try {
    const resp = await api.callMethod<{ namespaces?: Array<{ ns: string; value?: Record<string, unknown> }> }>(
      'settings.describe',
      {},
    );
    const namespaces = resp.result.value?.namespaces;
    const hit = namespaces?.find((n) => n.ns === ns)?.value?.[field];
    return typeof hit === 'string' ? hit : undefined;
  } catch {
    return undefined;
  }
}

/** agentPreset 名册(校验用);失败 undefined */
export async function readAgentPresetRoster(api: DshWebApiClient): Promise<readonly string[] | undefined> {
  try {
    const resp = await api.callMethod<{ presets?: Array<{ id: string }> }>('agentPreset.list', {});
    const presets = resp.result.value?.presets;
    return presets?.map((p) => p.id);
  } catch {
    return undefined;
  }
}

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('deepseekHarness').get<T>(key, fallback);
}

/**
 * 设置桥注册(theme/locale/permission/agentPreset/busyEnter + 反向轮询)。
 * @param baseUrl - 实例地址读取器。
 * @param isRunning - 当前是否有 agent 回合在跑(权限切换保护)。
 * @param isVisible - chat webview 是否可见(轮询节流)。
 * @param onLocaleApplied - 语言写回实例成功后回调(上游 locale 仅在 boot 时应用,
 *   运行中切换需重载 webview 才能生效 —— 与 switch-session 同模式)。
 */
export function registerSettingsBridge(
  baseUrl: () => string,
  isRunning: () => boolean,
  isVisible: () => boolean,
  onLocaleApplied: () => void = () => undefined,
): vscode.Disposable[] {
  // 反向回写抑制:轮询写 VS Code 设置时置位,change 处理器不再推实例(值已一致)
  let applyingExternal = false;

  const pushTheme = (): void => {
    const v = cfg<ThemeSetting>('theme', 'follow-web');
    if (v === 'follow-web') return;
    const api = new DshWebApiClient(baseUrl());
    void writeSettingField(api, THEME_NS, 'preference', v).then((err) => {
      if (err !== undefined) void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(theme=${v}):${err}`);
    });
  };
  const pushLocale = (): void => {
    const v = cfg<LocaleSetting>('locale', 'follow-web');
    if (v === 'follow-web') return;
    const api = new DshWebApiClient(baseUrl());
    void writeSettingField(api, LOCALE_NS, 'preference', v).then((err) => {
      if (err !== undefined) {
        void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(locale=${v}):${err}`);
        return;
      }
      // 语言写回成功 → 重载 webview(上游 locale 仅 boot 时应用,运行中不热切换)
      onLocaleApplied();
    });
  };
  const pushPermission = async (): Promise<void> => {
    if (applyingExternal) return;
    const next = cfg<PermissionSetting>('permissionMode', 'workspace-write');
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
    const api = new DshWebApiClient(baseUrl());
    const err = await writeSettingField(api, PERMISSION_NS, 'defaultPreset', next);
    if (err !== undefined) {
      void vscode.window.showWarningMessage(`dsh: 无法写回实例权限设置(permissionMode=${next}):${err}`);
    }
  };
  const pushAgentPreset = async (): Promise<void> => {
    if (applyingExternal) return;
    const next = cfg<string>('agentPreset', '');
    if (next === '') return; // 空 = 跟随实例当前默认,不写回
    const api = new DshWebApiClient(baseUrl());
    const roster = await readAgentPresetRoster(api);
    if (roster !== undefined && !roster.includes(next)) {
      void vscode.window.showWarningMessage(
        `dsh: agent preset "${next}" 不在实例名册中(可用:${roster.join(' / ')})`,
      );
      return;
    }
    const err = await writeSettingField(api, AGENT_PRESET_NS, 'default', next);
    if (err !== undefined) {
      void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(agentPreset=${next}):${err}`);
    }
  };
  const pushBusyEnter = (): void => {
    if (applyingExternal) return;
    const v = cfg<BusyEnterSetting>('busyEnter', 'queue');
    const api = new DshWebApiClient(baseUrl());
    void writeSettingField(api, CONVERSATION_NS, 'busyEnter', v).then((err) => {
      if (err !== undefined) void vscode.window.showWarningMessage(`dsh: 无法写回实例设置(busyEnter=${v}):${err}`);
    });
  };

  const pushAll = (): void => {
    pushTheme();
    pushLocale();
    void pushPermission();
    void pushAgentPreset();
    pushBusyEnter();
  };

  // 反向轮询:webview 可见时每 5s 读实例设置,漂移则回写 VS Code(抑制回环)
  const poll = async (): Promise<void> => {
    if (!isVisible()) return;
    const api = new DshWebApiClient(baseUrl());
    const [theme, locale, permission, preset, busyEnter] = await Promise.all([
      readSettingField(api, THEME_NS, 'preference'),
      readSettingField(api, LOCALE_NS, 'preference'),
      readSettingField(api, PERMISSION_NS, 'defaultPreset'),
      readSettingField(api, AGENT_PRESET_NS, 'default'),
      readSettingField(api, CONVERSATION_NS, 'busyEnter'),
    ]);
    const cfgRoot = vscode.workspace.getConfiguration('deepseekHarness');
    applyingExternal = true;
    try {
      // locale/theme 仅在用户显式选择具体值时跟随(follow-web 是"不干预"语义,不回写)
      if (theme !== undefined && cfg<ThemeSetting>('theme', 'follow-web') !== 'follow-web'
        && cfg<string>('theme', '') !== theme) {
        await cfgRoot.update('theme', theme, vscode.ConfigurationTarget.Global);
      }
      if (locale !== undefined && cfg<LocaleSetting>('locale', 'follow-web') !== 'follow-web'
        && cfg<string>('locale', '') !== locale) {
        await cfgRoot.update('locale', locale, vscode.ConfigurationTarget.Global);
        // 浏览器/上游改了语言 → VS Code 设置已同步,webview 需重载才应用新语言
        onLocaleApplied();
      }
      if (permission !== undefined && cfg<string>('permissionMode', '') !== permission) {
        await cfgRoot.update('permissionMode', permission, vscode.ConfigurationTarget.Global);
      }
      if (preset !== undefined && cfg<string>('agentPreset', '') !== preset) {
        await cfgRoot.update('agentPreset', preset, vscode.ConfigurationTarget.Global);
      }
      if (busyEnter !== undefined && cfg<string>('busyEnter', '') !== busyEnter) {
        await cfgRoot.update('busyEnter', busyEnter, vscode.ConfigurationTarget.Global);
      }
    } finally {
      applyingExternal = false;
    }
  };
  const timer = setInterval(() => { void poll(); }, 5000);
  void poll();

  const disposables: vscode.Disposable[] = [
    new vscode.Disposable(() => clearInterval(timer)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (applyingExternal) return;
      if (e.affectsConfiguration('deepseekHarness.theme')) pushTheme();
      else if (e.affectsConfiguration('deepseekHarness.locale')) pushLocale();
      else if (e.affectsConfiguration('deepseekHarness.permissionMode')) void pushPermission();
      else if (e.affectsConfiguration('deepseekHarness.agentPreset')) void pushAgentPreset();
      else if (e.affectsConfiguration('deepseekHarness.busyEnter')) pushBusyEnter();
    }),
  ];
  // 首次激活:把 VS Code 当前值推一次实例(幂等;实例未就绪时由轮询兜底)
  pushAll();
  return disposables;
}
