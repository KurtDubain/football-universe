import { compressedStorage, replaceCompressedStorageItem } from './compressed-storage';

type PersistedSave = {
  version: number;
  state: {
    world: {
      seasonState: unknown;
      teamBases: unknown;
      squads: unknown;
    };
  };
};

function parseCurrentSave(text: string, expectedVersion: number): PersistedSave {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON 存档');
  }

  const save = parsed as Partial<PersistedSave>;
  if (save.version !== expectedVersion) {
    throw new Error(`仅支持当前版本存档（需要 v${expectedVersion}）`);
  }
  const world = save.state?.world;
  if (!world || typeof world !== 'object'
    || !world.seasonState || !world.teamBases || !world.squads) {
    throw new Error('存档缺少当前版本所需的核心数据');
  }
  return save as PersistedSave;
}

export function exportCurrentSave(storageKey: string, expectedVersion: number): string {
  const raw = compressedStorage.getItem(storageKey) as string | null;
  if (!raw) throw new Error('当前没有可导出的存档');
  return JSON.stringify(parseCurrentSave(raw, expectedVersion), null, 2);
}

export function importCurrentSave(storageKey: string, text: string, expectedVersion: number): void {
  const save = parseCurrentSave(text, expectedVersion);
  replaceCompressedStorageItem(storageKey, JSON.stringify(save));
}
