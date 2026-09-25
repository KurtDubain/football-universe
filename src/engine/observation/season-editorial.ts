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
    const priorHonor = world.honorHistory.find(row => row.seasonNumber === season - 1);
    const change = priorHonor?.league1Champion === champion ? '连续两季夺得顶级联赛冠军'
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
  const movements = [...honor.promoted.map(row => ({ ...row, label: '升级' })), ...honor.relegated.map(row => ({ ...row, label: '降级' }))]
    .filter(row => row.teamId !== champion)
    .sort((a, b) => Number(favorites.includes(b.teamId)) - Number(favorites.includes(a.teamId)) || a.teamId.localeCompare(b.teamId));
  const movement = movements[0];
  const cup = [['世界杯', honor.worldCupWinner], ['联赛杯', honor.leagueCupWinner], ['超级杯', honor.superCupWinner]]
    .find(([, id]) => id && id !== champion);
  const worldCupBreakthrough = cup?.[0] === '世界杯' && !favorites.includes(movement?.teamId ?? '');
  if (movement && !worldCupBreakthrough) {
    const levels: Record<number, string> = { 1: '顶级', 2: '甲级', 3: '乙级' };
    add('movement', `${name(movement.teamId)}：${movement.label}`, `S${season}赛季结局 · ${levels[movement.from]}→${levels[movement.to]}联赛。`,
      'team', [movement.teamId], [destination(movement.teamId)]);
  } else {
    if (cup?.[1]) add('cup', `${name(cup[1])}赢得${cup[0]}`, `S${season}${cup[0]}冠军已归档。`, 'team', [cup[1]], [destination(cup[1])]);
  }
  return items.slice(0, 3);
}
