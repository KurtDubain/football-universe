import type { StateStorage } from 'zustand/middleware';
import { compressedStorage } from './compressed-storage';

export const SAVE_SCHEMA_VERSION = 24;
export const SAVE_STORAGE_KEY = 'football-universe-save';
export const SAVE_DIAGNOSTIC_KEY = `${SAVE_STORAGE_KEY}-invalid`;

type JsonRecord = Record<string, unknown>;

export interface CurrentSaveEnvelope {
  version: typeof SAVE_SCHEMA_VERSION;
  state: JsonRecord & {
    initialized: true;
    world: JsonRecord;
  };
}

export interface SaveRecoveryDiagnostic {
  recoveredAt: string;
  reason: string;
  payload: string;
}

let latestRecovery: SaveRecoveryDiagnostic | null = null;
let recoveryMessagePending = false;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (!isRecord(value)) throw new Error(`存档缺少当前版本所需字段：${key}`);
  return value;
}

function requireArray(parent: JsonRecord, key: string): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`存档缺少当前版本所需字段：${key}`);
  return value;
}

export function parseCurrentSave(text: string): CurrentSaveEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON 存档');
  }

  if (!isRecord(parsed)) throw new Error('存档顶层结构无效');
  if (parsed.version !== SAVE_SCHEMA_VERSION) {
    throw new Error(`仅支持当前版本存档（需要 v${SAVE_SCHEMA_VERSION}）`);
  }

  const state = requireRecord(parsed, 'state');
  if (state.initialized !== true) throw new Error('存档未包含已初始化的游戏状态');
  requireArray(state, 'lastResults');
  requireArray(state, 'lastNews');
  requireArray(state, 'favoriteTeamIds');
  if (state.favoriteTeamId !== null && typeof state.favoriteTeamId !== 'string') {
    throw new Error('存档字段 favoriteTeamId 无效');
  }

  const world = requireRecord(state, 'world');
  const seasonState = requireRecord(world, 'seasonState');
  if (!Number.isInteger(seasonState.seasonNumber) || (seasonState.seasonNumber as number) < 1) {
    throw new Error('存档赛季状态无效');
  }
  requireArray(seasonState, 'calendar');

  const teamBases = requireRecord(world, 'teamBases');
  const teamStates = requireRecord(world, 'teamStates');
  const squads = requireRecord(world, 'squads');
  requireRecord(world, 'playerStats');

  const teamIds = Object.keys(teamBases);
  if (teamIds.length === 0) throw new Error('存档没有球队数据');
  for (const teamId of teamIds) {
    if (!isRecord(teamStates[teamId])) throw new Error(`存档缺少球队状态：${teamId}`);
    if (!Array.isArray(squads[teamId])) throw new Error(`存档缺少球队阵容：${teamId}`);
  }

  return parsed as unknown as CurrentSaveEnvelope;
}

function quarantineInvalidSave(name: string, payload: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : '存档结构无效';
  latestRecovery = {
    recoveredAt: new Date().toISOString(),
    reason,
    payload,
  };
  recoveryMessagePending = true;

  compressedStorage.removeItem(name);
  try {
    localStorage.setItem(SAVE_DIAGNOSTIC_KEY, JSON.stringify(latestRecovery));
  } catch {
    // The in-memory diagnostic remains available when browser storage is full.
  }
}

export const currentSaveStorage: StateStorage = {
  getItem: (name) => {
    const raw = compressedStorage.getItem(name) as string | null;
    if (raw === null) return null;
    try {
      parseCurrentSave(raw);
      return raw;
    } catch (error) {
      quarantineInvalidSave(name, raw, error);
      return null;
    }
  },
  setItem: (name, value) => compressedStorage.setItem(name, value),
  removeItem: (name) => compressedStorage.removeItem(name),
};

export function getSaveRecoveryMessage(): string | null {
  if (!latestRecovery || !recoveryMessagePending) return null;
  return `检测到不兼容或损坏的存档，已隔离并返回新游戏。${latestRecovery.reason}`;
}

export function consumeSaveRecoveryMessage(): string | null {
  const message = getSaveRecoveryMessage();
  recoveryMessagePending = false;
  return message;
}

export function getLatestSaveRecoveryDiagnostic(): SaveRecoveryDiagnostic | null {
  return latestRecovery;
}

export function __resetSaveRecoveryForTests(): void {
  latestRecovery = null;
  recoveryMessagePending = false;
}
