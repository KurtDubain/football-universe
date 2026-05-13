import { CoachState } from '../../types/coach';

/**
 * Find the coach currently in charge of a team.
 *
 * After the v6 → v7 refactor, `coachStates[coachId].currentTeamId` is the
 * single source of truth for who coaches whom. The reverse direction —
 * "given a team, who is the coach?" — is now derived by walking
 * coachStates.
 *
 * Walks coachStates looking for one whose currentTeamId matches.
 * O(N coaches) — acceptable for ~36 coaches; if you need many lookups
 * during the same render or tick, build a map once with
 * {@link buildTeamCoachMap} and reuse it.
 *
 * Determinism: if (somehow) two coachStates point at the same team — which
 * would be a data bug — the FIRST one encountered in `Object.entries`
 * iteration order wins. Object key order is stable in JS for string keys
 * inserted in the same order, so this is reproducible.
 */
export function getTeamCoachId(
  coachStates: Record<string, CoachState>,
  teamId: string,
): string | null {
  for (const [coachId, cs] of Object.entries(coachStates)) {
    if (cs.currentTeamId === teamId) return coachId;
  }
  return null;
}

/**
 * Build a Map<teamId, coachId> for cases where you need many lookups in
 * one tick. Use inside engine functions that iterate over many teams,
 * or wrap with `useMemo` in React components that render many cards.
 *
 * If two coachStates point at the same team (data bug), the FIRST one in
 * iteration order wins — matches {@link getTeamCoachId} so callers see
 * consistent results regardless of which helper they used.
 */
export function buildTeamCoachMap(
  coachStates: Record<string, CoachState>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [coachId, cs] of Object.entries(coachStates)) {
    if (cs.currentTeamId == null) continue;
    if (map.has(cs.currentTeamId)) continue; // first wins, matches getTeamCoachId
    map.set(cs.currentTeamId, coachId);
  }
  return map;
}
