import type { GameWorld } from '../season/season-manager';
import type { Trophy } from '../../types/team';

const leagues = ['league1', 'league2', 'league3'] as const;
const has = (items: Trophy[], trophy: Trophy) => items.some(
  item => item.type === trophy.type && item.seasonNumber === trophy.seasonNumber,
);

/** Only retained, corroborated history is eligible. No simulation or current-coach lookup. */
export function repairLeagueHonors(
  world: GameWorld,
  onUncertainCoach?: (teamId: string, trophy: Trophy) => void,
): GameWorld {
  const repaired = { ...world, teamTrophies: { ...world.teamTrophies },
    coachTrophies: { ...world.coachTrophies }, coachCareers: { ...world.coachCareers } };
  let changed = false;
  const candidates = new Map<string, string>();
  const nominate = (teamId: string, seasonNumber: number, level: number) => {
    if (!world.teamBases[teamId] || !Number.isInteger(seasonNumber) || seasonNumber < 1
      || seasonNumber > world.seasonState.seasonNumber || !leagues[level - 1]) return;
    const key = `${seasonNumber}:${level}`;
    const previous = candidates.get(key);
    candidates.set(key, previous !== undefined && previous !== teamId ? '' : teamId);
  };
  for (const honor of world.honorHistory) {
    leagues.forEach((type, i) => nominate(honor[`${type}Champion`], honor.seasonNumber, i + 1));
  }
  for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
    for (const record of records) {
      if (record.leaguePosition === 1 && record.leaguePlayed > 0) {
        nominate(teamId, record.seasonNumber, record.leagueLevel);
      }
    }
  }
  for (const [key, teamId] of candidates) {
    if (!teamId) continue;
    const [seasonNumber, level] = key.split(':').map(Number);
    const records = (world.teamSeasonRecords[teamId] ?? []).filter(r => r.seasonNumber === seasonNumber);
    if (records.some(r => r.leagueLevel !== level || r.leaguePosition !== 1 || r.leaguePlayed <= 0)) continue;
    const trophy: Trophy = { type: leagues[level - 1], seasonNumber };
    const append = (items: Trophy[] = []) => {
      if (has(items, trophy)) return items;
      changed = true;
      return [...items, trophy];
    };
    repaired.teamTrophies[teamId] = append(repaired.teamTrophies[teamId]);

    const careers = Object.entries(world.coachCareers).flatMap(([coachId, entries]) =>
      entries.flatMap((entry, index) =>
        entry.teamId === teamId && entry.fromSeason <= seasonNumber
        && (entry.toSeason === null || entry.toSeason >= seasonNumber)
          ? [{ coachId, entry, index }] : []));
    // Retirement snapshots are taken at the title-awarding boundary. The successor
    // starts in the same numbered season, so a SeasonRecord.coachId alone is unsafe.
    const retirees = world.coachRetirementHistory.filter(r =>
      r.seasonRetired === seasonNumber && r.finalTeamId === teamId);
    const retiredOwner = retirees.length === 1
      ? careers.filter(c => c.coachId === retirees[0].id && c.entry.toSeason === seasonNumber) : [];
    const owner = retirees.length > 0
      ? (retiredOwner.length === 1 ? retiredOwner[0] : undefined)
      : (careers.length === 1 && records.length === 1 && records[0].coachId === careers[0].coachId
        && (careers[0].entry.fromSeason < seasonNumber || (seasonNumber === 1 && !careers[0].coachId.startsWith('c-')))
        ? careers[0] : undefined);
    // Another coach's existing title is conflicting evidence, not permission to reassign it.
    if (!owner || !world.coachBases[owner.coachId] || Object.entries(world.coachTrophies).some(([id, trophies]) =>
      id !== owner.coachId && has(trophies, trophy))) {
      onUncertainCoach?.(teamId, trophy);
      continue;
    }
    const { coachId, index } = owner;
    repaired.coachTrophies[coachId] = append(repaired.coachTrophies[coachId]);
    const entries = repaired.coachCareers[coachId];
    const trophies = append(entries[index].trophies);
    if (trophies !== entries[index].trophies) {
      const updated = entries.slice();
      updated[index] = { ...entries[index], trophies };
      repaired.coachCareers[coachId] = updated;
    }
    repaired.coachRetirementHistory = repaired.coachRetirementHistory.map(r => {
      const trophies = r.id === coachId && r.seasonRetired >= seasonNumber ? append(r.trophies) : r.trophies;
      return trophies === r.trophies ? r : { ...r, trophies };
    });
  }
  return changed ? repaired : world;
}
