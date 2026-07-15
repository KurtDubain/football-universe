import { compressedStorage, replaceCompressedStorageItem } from './compressed-storage';
import { parseCurrentSave } from './save-schema';

export function exportCurrentSave(storageKey: string): string {
  const raw = compressedStorage.getItem(storageKey) as string | null;
  if (!raw) throw new Error('当前没有可导出的存档');
  return JSON.stringify(parseCurrentSave(raw), null, 2);
}

export function importCurrentSave(storageKey: string, text: string): void {
  const save = parseCurrentSave(text);
  replaceCompressedStorageItem(storageKey, JSON.stringify(save));
}
