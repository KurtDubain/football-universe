import { preset } from './preset';
export const EDITION = preset.edition;
export const PRESET_ID = preset.presetId;
export const EDITION_LABEL = preset.label;
export const ALLOW_CUSTOM_CONTENT = preset.allowCustomContent;
export function editionStorageKey(personalKey: string): string {
  return EDITION === 'personal' ? personalKey : `football-${EDITION}-${PRESET_ID}:${personalKey}`;
}
export function requireCustomContent(): void {
  if (!ALLOW_CUSTOM_CONTENT) throw new Error('参赛版已关闭导入与球队编辑');
}
