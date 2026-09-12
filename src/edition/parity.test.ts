import { expect, it, vi } from 'vitest';
import * as personal from './personal';
import * as contest from './contest';
import personalCoaches from './personal/coaches.json';
import contestCoaches from './contest/coaches.json';

const identityKeys = new Set(['id', 'uuid', 'teamId', 'homeTeamId', 'awayTeamId', 'winnerId', 'coachId', 'position', 'type', 'status']);
function numericIdentity(value: unknown, key = ''): unknown {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'string') return identityKeys.has(key) ? value : undefined;
  if (Array.isArray(value)) return value.map(v => numericIdentity(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, numericIdentity(v, k)]).filter(([, v]) => v !== undefined));
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(numericIdentity(value)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

it('preserves all numeric world data, IDs, fixtures, results and RNG over five seasons for three seeds', async () => {
  const snapshots: string[][] = [];
  for (const edition of [personal, contest]) {
    vi.resetModules(); vi.doMock('./preset', () => edition);
    vi.doMock('./coach-names', () => ({ default: edition === personal ? personalCoaches : contestCoaches }));
    const engine = await import('../engine/season/season-manager');
    const hashes: string[] = [];
    for (const seed of [20260709, 42, 93896]) {
      let world = engine.initializeGameWorld(seed);
      hashes.push(await digest(world));
      let guard = 0;
      while (world.seasonState.seasonNumber <= 5 && guard++ < 350) {
        const out = engine.executeCurrentWindow(world);
        expect(out.world).not.toBe(world);
        world = out.world;
        hashes.push(await digest({ world, results: out.results }));
      }
      expect(world.seasonState.seasonNumber).toBe(6);
    }
    snapshots.push(hashes);
  }
  vi.doUnmock('./preset'); vi.doUnmock('./coach-names'); vi.resetModules();
  expect(snapshots[1]).toEqual(snapshots[0]);
}, 180_000);
