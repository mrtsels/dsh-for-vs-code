/**
 * preset/presentation.ts — upstream preset display names adapter.
 *
 * Source of truth: upstream ui-agent-preset/locales.ts
 * (vendor/deepseek-harness/packages/client/ui-agent-preset/src/client/locales.ts)
 *
 * Preset ID ≠ display name:
 *   API / persistence / equality → preset.id (e.g. "code")
 *   UI / user-facing             → getPresetDisplayName(id) (e.g. "PTC mode")
 *
 * Unknown presets fallback to their ID (custom presets work out of the box).
 *
 * M7 (dedup-plan): presentation data dedup with upstream.
 */

/**
 * Built-in preset display names.
 * Synced from upstream ui-agent-preset/locales.ts (en locale).
 * Last synced: rc.7 (2026-08-18)
 */
const PRESET_DISPLAY_NAMES: Record<string, string> = {
  standard: 'Standard mode',
  code: 'PTC mode',
  minimal: 'Minimal mode',
  cordis: 'Creator mode',
};

/**
 * Get the user-facing display name for a preset ID.
 * Falls back to the ID itself for unknown/custom presets.
 */
export function getPresetDisplayName(id: string): string {
  return PRESET_DISPLAY_NAMES[id] ?? id;
}
