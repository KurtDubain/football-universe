import { useEffect, useState } from 'react';
import { editionStorageKey } from '../edition/policy';

function readSessionValue<T>(key: string, fallback: T): T {
  if (typeof sessionStorage === 'undefined') return fallback;
  try {
    const stored = sessionStorage.getItem(editionStorageKey(key));
    return stored === null ? fallback : JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

export function useUiSessionState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readSessionValue(key, fallback));

  useEffect(() => {
    try {
      sessionStorage.setItem(editionStorageKey(key), JSON.stringify(value));
    } catch {
      // Session continuity is optional when storage is unavailable.
    }
  }, [key, value]);

  return [value, setValue];
}
