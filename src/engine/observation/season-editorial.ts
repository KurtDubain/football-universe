import type { GameWorld } from '../season/season-manager';
import type { NarrativeItem, NarrativeDestination } from './narrative-types';
import { PLAYER_AWARD_LABELS } from '../players/player-honors';

/** Three editorial seats, derived from completed records, never from the last matchday. */
export function buildSeasonEditorial(world: GameWorld, season: number, favorites: readonly string[] = [], followed: readonly string[] = []): NarrativeItem[] {
  const honor = world.honorHistory.find(row => row.seasonNumber === season);
  if (!honor) return [];
  const items: NarrativeItem[] = [];
  const name = (id: string) => world.teamBases[id]?.name ?? id;
  const destination = (id: string): NarrativeDestination => ({ key: id, label: name(id), to: `/team/${id}` });
  const add = (key: string, title: string, summary: string, subjectType: 'team' | 'player', subjectIds: string[], destinations: NarrativeDestination[]) => {
    items.push({ id: `season-editorial:${season}:${key}`, arcKey: `season-editorial:${season}:${key}`,
      eventKey: `season-editorial:${season}:${key}`, source: subjectType === 'player' ? 'player_story' : 'competition',
      subjectType, subjectIds, seasonNumber: season, seasonPhase: '赛季封存', title, summary,
      destinations, evidence: [{ key, label: `S${season}档案`, detail: summary, source: 'record' }],
      fingerprint: `${title}:${summary}`, changedAt: world.totalElapsedWindows ?? 0,
      visualLevel: 'chapter', visualKind: 'legacy', editorialState: 'new' });
  };
  const champion = honor.league1Champion;
  if (champion) {
    const previous = world.teamSeasonRecords[champion]?.find(row => row.seasonNumber === season - 1);
    let streak = 1;
    while (world.honorHistory.find(row => row.seasonNumber === season - streak)?.league1Champion === champion) streak++;
    const knownStart = season - streak === 0 || world.honorHistory.some(row => row.seasonNumber === season - streak);
    const change = streak > 1 ? `${knownStart ? '' : '现存记录中'}连续${streak}季夺得顶级联赛冠军`
      : previous?.leagueLevel === 1 && previous.leaguePosition > 0 ? `从上季第${previous.leaguePosition}名到本季顶级联赛冠军`
        : '夺得本季顶级联赛冠军';
    const cups = [['联赛杯', honor.leagueCupWinner], ['超级杯', honor.superCupWinner], ['世界杯', honor.worldCupWinner]]
      .filter(([, id]) => id === champion).map(([label]) => label);
    add('champion', `${name(champion)}：${change}`, `S${season}冠军已归档${cups.length ? `，同季还赢得${cups.join('、')}` : ''}。`, 'team', [champion], [destination(champion)]);
  }
  const awards = world.playerAwardsHistory.filter(row => row.season === season && row.type !== 'young_player');
  const ranked = awards.slice().sort((a, b) => Number(b.type === 'mvp') - Number(a.type === 'mvp')
    || Number(followed.includes(b.playerId)) - Number(followed.includes(a.playerId))
    || a.playerId.localeCompare(b.playerId));
  const winner = ranked[0];
  if (winner) {
    const ownAwards = awards.filter(row => row.playerId === winner.playerId);
    const repeat = world.playerAwardsHistory.some(row => row.season === season - 1 && row.playerId === winner.playerId && row.type === winner.type);
    add('person', `${winner.playerName}${repeat ? '蝉联' : '获得'}${PLAYER_AWARD_LABELS[winner.type]}`,
      `S${season} · ${ownAwards.map(row => `${PLAYER_AWARD_LABELS[row.type]}：${row.statLabel}`).join('；')}。`,
      'player', [winner.playerId], [{ key: winner.playerId, label: '查看获奖依据', to: `/player/${winner.playerId}#awards-S${season}` }]);
  }
  const usedTeams = new Set(items.filter(item => item.subjectType === 'team').flatMap(item => item.subjectIds));
  const candidates: { id: string; key: string; priority: number; title: string; summary: string }[] = [];
  const levels: Record<number, string> = { 1: '顶级', 2: '甲级', 3: '乙级' };
  for (const row of [...honor.promoted.map(row => ({ ...row, label: '升级' })), ...honor.relegated.map(row => ({ ...row, label: '降级' }))]) {
    candidates.push({ id: row.teamId, key: 'movement', priority: favorites.includes(row.teamId) ? 0 : row.from === 1 || row.to === 1 ? 1 : 3,
      title: `${name(row.teamId)}：${row.label}`, summary: `S${season}赛季结局 · ${levels[row.from]}→${levels[row.to]}联赛。` });
  }
  // Only a recorded year-on-year improvement is called a breakthrough, not every cup title.
  const rounds = ['小组赛', '32强', '16强', '八强', '四强', '亚军', '冠军'];
  for (const [id, records] of Object.entries(world.teamSeasonRecords)) {
    const current = records.find(row => row.seasonNumber === season);
    const previous = records.find(row => row.seasonNumber === season - 1);
    for (const [field, label] of [['cupResult', '联赛杯'], ['superCupResult', '超级杯'], ['worldCupResult', '世界杯'], ['continentalCupResult', '洲际杯']] as const) {
      const now = rounds.indexOf(current?.[field] ?? '');
      const before = rounds.indexOf(previous?.[field] ?? '');
      if (now < 4 || before < 0 || now <= before) continue;
      candidates.push({ id, key: `cup-progress:${field}`, priority: favorites.includes(id) ? 0 : 2,
        title: `${name(id)}：${label}更进一步`, summary: `上季${previous![field]} → 本季${current![field]}。` });
    }
  }
  for (const [label, id] of [['世界杯', honor.worldCupWinner], ['联赛杯', honor.leagueCupWinner], ['超级杯', honor.superCupWinner]]) {
    if (id) candidates.push({ id, key: 'cup', priority: favorites.includes(id) ? 0 : 4,
      title: `${name(id)}赢得${label}`, summary: `S${season}${label}冠军已归档。` });
  }
  const third = candidates.filter(row => !usedTeams.has(row.id))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
      || Number(b.key === 'movement') - Number(a.key === 'movement') || a.key.localeCompare(b.key))[0];
  if (third) add(third.key, third.title, third.summary, 'team', [third.id], [destination(third.id)]);
  return items.slice(0, 3);
}
