import { editionStorageKey } from '../edition/policy';
export const SAVE_SCHEMA_VERSION = 25;
export const SAVE_STORAGE_KEY = editionStorageKey('football-universe-save');
export const SAVE_DIAGNOSTIC_KEY = `${SAVE_STORAGE_KEY}-invalid`;
