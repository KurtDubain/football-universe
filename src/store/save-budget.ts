export const LOCAL_STORAGE_DESIGN_BYTES = 5 * 1024 * 1024;
export const SAVE_WARNING_BYTES = 4 * 1024 * 1024;
export const LONG_SAVE_TARGET_SEASON = 150;
export const LONG_SAVE_TARGET_BYTES = 4 * 1024 * 1024;

export function conservativeUTF16Bytes(value: string | null): number {
  return value ? value.length * 2 : 0;
}

export function isSaveNearCapacity(bytes: number): boolean {
  return bytes >= SAVE_WARNING_BYTES;
}
