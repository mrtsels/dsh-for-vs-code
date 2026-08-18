# ChatGPT 求助：M7 UI Component Dedup — 上游 ui-agent-preset 复用可行性

## 背景

VS Code 扩展（dsh-for-vs-code）是上游 deepseek-harness 的薄客户端。M1-M6 已完成 wire type + transport convergence。M7 要解决 **UI/presentation layer** 的 dedup——扩展自维护的 preset 展示逻辑应该复用上游 `ui-agent-preset` 包。

### 触发事件

rc.5→rc.7 上游将 preset 显示名从 "code" 改为 "PTC mode"、"cordis" 改为 "Creator mode"。扩展 `package.json` description 仍硬编码旧名 `standard / code / minimal / cordis`。

## 上游 ui-agent-preset 包架构

```typescript
// vendor/deepseek-harness/packages/client/ui-agent-preset/src/client/

// 本地化字符串
export const en: Record<AgentPresetSettingsKey, string> = {
  presetStandardName: 'Standard mode',
  presetCodeName: 'PTC mode',        // ← 已改名
  presetMinimalName: 'Minimal mode',
  presetCordisName: 'Creator mode',  // ← 已改名
  // ... 还有 description、UI labels 等
}

// React 组件（浏览器端）
AgentPresetLabel.tsx    — 标签组件
AgentPresetRow.tsx      — 行组件
AgentPresetSeat.tsx     — 座位组件
AgentPresetSection.tsx  — 区段组件
PresetMenu.tsx          — 菜单组件

// 设置 store
AGENT_PRESET_SETTINGS_NS  — settings namespace
writeDefaultPreset()      — 写默认 preset

// 注入依赖
export const inject = ['slots', 'locale', 'connection', 'remote']
export function apply(ctx: ClientContext): void { ... }
```

## 扩展侧现状

### 1. package.json（硬编码）
```json
"description": "新建会话的 agent preset 默认(...可用 preset 见实例名册(standard / code / minimal / cordis,可含自定义)。...)"
```

### 2. settings-bridge.ts（已用 DshWebApiClient）
```typescript
// 已通过 api.callMethod('agentPreset.list') 动态获取 preset 名册
// 但显示名仍用 hardcoded string
```

### 3. extension.ts（preset 选择命令）
```typescript
// 从 api.agentPreset.list() 动态获取 preset 列表
// 显示 label 直接用 preset.id（如 "code"），没用上游的 "PTC mode" 显示名
```

### 4. webview（SessionView.tsx）
```typescript
// 有自己的 SessionItem 接口，不依赖上游 ui-agent-preset
// 有独立的 inline RPC（不走 DshWebApiClient）
```

## 我需要你想的

### 问题1：ui-agent-preset 能否在 VS Code webview 中运行？

上游组件是 React 组件，用了 `inject = ['slots', 'locale', 'connection', 'remote']`。

VS Code webview 是独立的 React bundle。能否直接 import `ui-agent-preset` 的组件？

阻碍因素可能：
- `apply(ctx)` 需要 Cordis context（`ClientContext`）
- `inject` 依赖 `slots`, `locale`, `connection`, `remote` — 这些是上游 web runtime 的 DI tokens
- VS Code webview 没有 Cordis runtime

如果不能直接用，有没有折中方案？

### 问题2：如果不能直接用组件，能否只复用 locales.ts？

`locales.ts` 是纯数据（`Record<Key, string>`），零依赖。

选项：
- A）import `locales.ts`（需要 vitest alias 类似处理）
- B）把 preset 显示名做成 JSON，扩展动态加载
- C）扩展自己维护一份映射表，但来源标注为上游

### 问题3：extension.ts 的 preset 选择命令怎么改？

当前：
```typescript
const presets = resp.result.value?.presets;  // [{id: 'code', ...}]
// 显示 label 直接用 id
```

应该：
```typescript
// 用上游显示名
const displayNames: Record<string, string> = {
  standard: 'Standard mode',
  code: 'PTC mode',
  minimal: 'Minimal mode',
  cordis: 'Creator mode',
};
// fallback: 没有映射就用 id
```

这个映射表应该放在哪里？
- A）硬编码在 extension.ts（简单但需要手动同步）
- B）从上游 locales.ts import（需要 alias 处理）
- C）从 api.agentPreset.list() 动态获取（如果上游返回 displayName 字段）

### 问题4：package.json description 怎么改？

当前硬编码了 `standard / code / minimal / cordis`。

选项：
- A）改成动态描述："可用 preset 见实例名册"（去掉具体名字）
- B）改成上游新名："standard / PTC / minimal / Creator"
- C）保持现状，等用户反馈再改

### 问题5：webview 的 SessionView.tsx 怎么处理？

webview 有自己独立的 RPC 和 SessionItem 接口。是否需要：
- A）让 webview 也用 DshWebApiClient（通过 message passing）
- B）保持 webview 独立，但同步显示名
- C）让 webview 直接 import 上游 ui-agent-preset 组件

### 问题6：M7 的实际改动量

如果只做"同步显示名"（不做组件复用），改动量大概是：
1. package.json description 改一行
2. extension.ts preset 选择命令加映射表
3. 可能还有 webview 中的 preset 显示

如果做"组件复用"，可能需要：
1. 创建 webview bundle 的 alias 配置
2. 处理 Cordis 依赖链
3. 重写 webview preset 相关 UI

你建议 M7 做到什么程度？
