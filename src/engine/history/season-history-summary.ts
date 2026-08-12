import type { Trophy } from '../../types/team';
import type { GameWorld } from '../season/season-manager';
import type { Storyline, StorylineType } from '../season/storylines';

export type SeasonHistoryEventType =
  | 'league'
  | 'cups'
  | 'movement'
  | 'deviation'
  | 'story'
  | 'person';

export interface SeasonHistoryLink {
  label: string;
  to: string;
  kind: 'team' | 'player' | 'coach' | 'match';
}

export interface SeasonHistoryEvent {
  id: string;
  type: SeasonHistoryEventType;
  title: string;
  detail: string;
  links: SeasonHistoryLink[];
  replayStatus?: 'available' | 'summary_only';
}

export interface SeasonHistoryLabel {
  id: string;
  type: 'dynasty' | 'promotion_run' | 'relegation_run' | 'decline';
  title: string;
  detail: string;
  teamId: string;
}

export interface SeasonHistorySummary {
  seasonNumber: number;
  events: SeasonHistoryEvent[];
  labels: SeasonHistoryLabel[];
}

export const MAX_SEASON_HISTORY_EVENTS = 7;
export const DYNASTY_MIN_TITLES = 3;
export const MOVEMENT_RUN_MIN_SEASONS = 2;
export const DECLINE_MIN_SEASONS = 3;

const STORY_LABELS: Record<StorylineType, string> = {
  dark_horse: '黑马崛起',
  giant_crisis: '豪门危机',
  promoted_survival: '升班马求生',
  unbeaten_run: '联赛不败征程',
  cup_giant_killer: '杯赛巨人杀手',
};

const AWARD_PRIORITY: Record<string, number> = {
  mvp: 4,
  golden_boot: 3,
  best_defender: 2,
  best_goalkeeper: 2,
  young_player: 1,
};

const CUP_LABELS: Partial<Record<Trophy['type'], string>> = {
  league_cup: '联赛杯',
  super_cup: '超级杯',
  world_cup: '环球冠军杯',
  mainland_cup: '大陆杯',
  southern_cup: '南洲杯',
  eastern_cup: '东洲杯',
};

function teamName(world: Pick<GameWorld, 'teamBases'>, teamId: string): string {
  return world.teamBases[teamId]?.name ?? teamId;
}

function teamLink(
  world: Pick<GameWorld, 'teamBases'>,
  teamId: string,
  prefix?: string,
): SeasonHistoryLink {
  const name = teamName(world, teamId);
  return {
    label: prefix ? `${prefix} · ${name}` : name,
    to: `/team/${teamId}`,
    kind: 'team',
  };
}

function uniqueLinks(links: SeasonHistoryLink[]): SeasonHistoryLink[] {
  const seen = new Set<string>();
  return links.filter(link => {
    const key = `${link.kind}:${link.to}:${link.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function seasonCupWinners(
  world: Pick<GameWorld, 'teamTrophies'>,
  seasonNumber: number,
): Array<{ teamId: string; type: Trophy['type'] }> {
  return Object.entries(world.teamTrophies)
    .flatMap(([teamId, trophies]) => trophies
      .filter(trophy => trophy.seasonNumber === seasonNumber && CUP_LABELS[trophy.type])
      .map(trophy => ({ teamId, type: trophy.type })))
    .sort((a, b) => a.type.localeCompare(b.type) || a.teamId.localeCompare(b.teamId));
}

function seasonStories(
  history: Storyline[] | undefined,
  seasonNumber: number,
): Storyline[] {
  return (history ?? [])
    .filter(storyline =>
      storyline.seasonNumber === seasonNumber
      && storyline.phase === '落幕'
      && Boolean(storyline.conclusion),
    )
    .sort((a, b) =>
      Number(b.outcome === 'success') - Number(a.outcome === 'success')
      || (b.endedWindow ?? b.lastUpdatedWindow) - (a.endedWindow ?? a.lastUpdatedWindow)
      || a.id.localeCompare(b.id),
    )
    .slice(0, 2);
}

function buildSeasonEvents(
  world: Pick<GameWorld,
    | 'honorHistory'
    | 'teamBases'
    | 'coachBases'
    | 'teamTrophies'
    | 'teamSeasonRecords'
    | 'observerSeasonTrajectories'
    | 'storylineHistory'
    | 'playerAwardsHistory'
    | 'memorableMatches'
  >,
  seasonNumber: number,
): SeasonHistoryEvent[] {
  const honor = world.honorHistory.find(record => record.seasonNumber === seasonNumber);
  if (!honor) return [];

  const events: SeasonHistoryEvent[] = [];
  const leagueLinks = [
    honor.league1Champion && teamLink(world, honor.league1Champion, '顶级'),
    honor.league2Champion && teamLink(world, honor.league2Champion, '甲级'),
    honor.league3Champion && teamLink(world, honor.league3Champion, '乙级'),
  ].filter((link): link is SeasonHistoryLink => Boolean(link));
  const championRecord = world.teamSeasonRecords[honor.league1Champion]
    ?.find(record => record.seasonNumber === seasonNumber);
  const championCoach = championRecord
    ? world.coachBases[championRecord.coachId]
    : undefined;
  if (championRecord && championCoach) {
    leagueLinks.push({
      label: `冠军主帅 · ${championCoach.name}`,
      to: `/coach/${championRecord.coachId}`,
      kind: 'coach',
    });
  }
  events.push({
    id: `S${seasonNumber}-league`,
    type: 'league',
    title: '三级联赛冠军归属',
    detail: `顶级联赛由${teamName(world, honor.league1Champion)}夺冠，次级联赛冠军也已写入本季历史。`,
    links: leagueLinks,
  });

  const cupWinners = seasonCupWinners(world, seasonNumber);
  const cupLinks = cupWinners.map(winner =>
    teamLink(world, winner.teamId, CUP_LABELS[winner.type]),
  );
  events.push({
    id: `S${seasonNumber}-cups`,
    type: 'cups',
    title: '主要杯赛尘埃落定',
    detail: cupLinks.length > 0
      ? `本季共记录${cupLinks.length}项杯赛冠军。`
      : '本季没有可核对的主要杯赛冠军记录。',
    links: uniqueLinks(cupLinks),
  });

  const promotedLinks = honor.promoted.map(entry =>
    teamLink(world, entry.teamId, `${entry.from}级升${entry.to}级`),
  );
  const relegatedLinks = honor.relegated.map(entry =>
    teamLink(world, entry.teamId, `${entry.from}级降${entry.to}级`),
  );
  events.push({
    id: `S${seasonNumber}-movement`,
    type: 'movement',
    title: '联赛版图发生变化',
    detail: `升级${honor.promoted.length}队，降级${honor.relegated.length}队。`,
    links: [...promotedLinks, ...relegatedLinks],
  });

  const trajectory = (world.observerSeasonTrajectories ?? [])
    .find(entry => entry.seasonNumber === seasonNumber);
  const deviation = trajectory?.destinyDeviation;
  if (deviation) {
    const replayAvailable = (world.memorableMatches ?? [])
      .some(entry => entry.result.fixtureId === deviation.fixtureId);
    const isUpset = deviation.tier === 'upset' || deviation.tier === 'major_upset';
    events.push({
      id: `S${seasonNumber}-deviation`,
      type: 'deviation',
      title: isUpset ? '本季最大爆冷' : '本季最大命运偏差',
      detail: [
        `${teamName(world, deviation.homeTeamId)} ${deviation.homeGoals}-${deviation.awayGoals} ${teamName(world, deviation.awayTeamId)}`,
        `${deviation.competitionName} · ${deviation.roundLabel}`,
        `实际走向赛前概率${deviation.actualProbability}%`,
        replayAvailable ? null : '详细回放已按存储上限清理',
      ].filter(Boolean).join(' · '),
      links: [
        teamLink(world, deviation.homeTeamId),
        teamLink(world, deviation.awayTeamId),
        ...(replayAvailable ? [{
          label: '查看经典回放',
          to: `/memorable?fixture=${encodeURIComponent(deviation.fixtureId)}`,
          kind: 'match' as const,
        }] : []),
      ],
      replayStatus: replayAvailable ? 'available' : 'summary_only',
    });
  }

  for (const storyline of seasonStories(world.storylineHistory, seasonNumber)) {
    events.push({
      id: `S${seasonNumber}-story-${storyline.id}`,
      type: 'story',
      title: `故事落幕：${STORY_LABELS[storyline.type]}`,
      detail: storyline.conclusion ?? storyline.evidence.join(' · '),
      links: [teamLink(world, storyline.teamId)],
    });
  }

  const award = (world.playerAwardsHistory ?? [])
    .filter(item => item.season === seasonNumber)
    .sort((a, b) =>
      (AWARD_PRIORITY[b.type] ?? 0) - (AWARD_PRIORITY[a.type] ?? 0)
      || b.statValue - a.statValue
      || a.playerId.localeCompare(b.playerId),
    )[0];
  if (award) {
    events.push({
      id: `S${seasonNumber}-person`,
      type: 'person',
      title: '本季代表人物',
      detail: `${award.playerName} · ${award.statLabel}`,
      links: [
        {
          label: award.playerName,
          to: `/player/${award.playerId}`,
          kind: 'player',
        },
        teamLink(world, award.teamId),
      ],
    });
  }

  return events.slice(0, MAX_SEASON_HISTORY_EVENTS);
}

function movementRun(
  honors: GameWorld['honorHistory'],
  seasonNumber: number,
  kind: 'promoted' | 'relegated',
): Array<{ teamId: string; length: number; fromSeason: number }> {
  const sorted = honors
    .filter(record => record.seasonNumber <= seasonNumber)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  const currentIndex = sorted.findIndex(record => record.seasonNumber === seasonNumber);
  if (currentIndex < 0) return [];
  return sorted[currentIndex][kind].map(entry => {
    let length = 1;
    let cursor = currentIndex - 1;
    let expectedSeason = seasonNumber - 1;
    while (
      cursor >= 0
      && sorted[cursor].seasonNumber === expectedSeason
      && sorted[cursor][kind].some(item => item.teamId === entry.teamId)
    ) {
      length++;
      cursor--;
      expectedSeason--;
    }
    return { teamId: entry.teamId, length, fromSeason: seasonNumber - length + 1 };
  }).filter(run => run.length >= MOVEMENT_RUN_MIN_SEASONS);
}

function isWorseSeason(
  previous: { leagueLevel: number; leaguePosition: number },
  next: { leagueLevel: number; leaguePosition: number },
): boolean {
  return next.leagueLevel > previous.leagueLevel
    || (next.leagueLevel === previous.leagueLevel && next.leaguePosition > previous.leaguePosition);
}

function declineLabels(
  world: Pick<GameWorld, 'teamSeasonRecords' | 'teamBases'>,
  seasonNumber: number,
): SeasonHistoryLabel[] {
  const labels: SeasonHistoryLabel[] = [];
  for (const [teamId, sourceRecords] of Object.entries(world.teamSeasonRecords)) {
    const records = sourceRecords
      .filter(record => record.seasonNumber <= seasonNumber)
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
    const endIndex = records.findIndex(record => record.seasonNumber === seasonNumber);
    if (endIndex < DECLINE_MIN_SEASONS - 1) continue;

    let startIndex = endIndex;
    while (
      startIndex > 0
      && records[startIndex - 1].seasonNumber === records[startIndex].seasonNumber - 1
      && isWorseSeason(records[startIndex - 1], records[startIndex])
    ) {
      startIndex--;
    }
    const length = endIndex - startIndex + 1;
    if (length < DECLINE_MIN_SEASONS) continue;
    const first = records[startIndex];
    const last = records[endIndex];
    const substantial = last.leagueLevel > first.leagueLevel
      || last.leaguePosition - first.leaguePosition >= 4;
    if (!substantial) continue;
    labels.push({
      id: `S${seasonNumber}-decline-${teamId}`,
      type: 'decline',
      title: `${teamName(world, teamId)}连续${length}季滑落`,
      detail: `S${first.seasonNumber}的${first.leagueLevel}级第${first.leaguePosition}，降至S${last.seasonNumber}的${last.leagueLevel}级第${last.leaguePosition}。`,
      teamId,
    });
  }
  return labels;
}

export function buildSeasonHistoryLabels(
  world: Pick<GameWorld, 'honorHistory' | 'teamSeasonRecords' | 'teamBases'>,
  seasonNumber: number,
): SeasonHistoryLabel[] {
  const honor = world.honorHistory.find(record => record.seasonNumber === seasonNumber);
  if (!honor) return [];
  const labels: SeasonHistoryLabel[] = [];

  let dynastyLength = 1;
  let cursorSeason = seasonNumber - 1;
  const earlier = world.honorHistory
    .filter(record => record.seasonNumber < seasonNumber)
    .sort((a, b) => b.seasonNumber - a.seasonNumber);
  for (const record of earlier) {
    if (record.seasonNumber !== cursorSeason || record.league1Champion !== honor.league1Champion) break;
    dynastyLength++;
    cursorSeason--;
  }
  if (dynastyLength >= DYNASTY_MIN_TITLES) {
    labels.push({
      id: `S${seasonNumber}-dynasty-${honor.league1Champion}`,
      type: 'dynasty',
      title: `${teamName(world, honor.league1Champion)}建立王朝`,
      detail: `S${seasonNumber - dynastyLength + 1}至S${seasonNumber}完成顶级联赛${dynastyLength}连冠。`,
      teamId: honor.league1Champion,
    });
  }

  for (const run of movementRun(world.honorHistory, seasonNumber, 'relegated')) {
    labels.push({
      id: `S${seasonNumber}-relegation-${run.teamId}`,
      type: 'relegation_run',
      title: `${teamName(world, run.teamId)}连续降级`,
      detail: `S${run.fromSeason}至S${seasonNumber}连续${run.length}季降级。`,
      teamId: run.teamId,
    });
  }
  for (const run of movementRun(world.honorHistory, seasonNumber, 'promoted')) {
    labels.push({
      id: `S${seasonNumber}-promotion-${run.teamId}`,
      type: 'promotion_run',
      title: `${teamName(world, run.teamId)}连续升级`,
      detail: `S${run.fromSeason}至S${seasonNumber}连续${run.length}季升级。`,
      teamId: run.teamId,
    });
  }

  labels.push(...declineLabels(world, seasonNumber));
  const priority: Record<SeasonHistoryLabel['type'], number> = {
    dynasty: 4,
    relegation_run: 3,
    promotion_run: 2,
    decline: 1,
  };
  return labels
    .sort((a, b) => priority[b.type] - priority[a.type] || a.teamId.localeCompare(b.teamId))
    .slice(0, 4);
}

export function buildSeasonHistorySummary(
  world: Pick<GameWorld,
    | 'honorHistory'
    | 'teamBases'
    | 'coachBases'
    | 'teamTrophies'
    | 'teamSeasonRecords'
    | 'observerSeasonTrajectories'
    | 'storylineHistory'
    | 'playerAwardsHistory'
    | 'memorableMatches'
  >,
  seasonNumber: number,
): SeasonHistorySummary | null {
  if (!world.honorHistory.some(record => record.seasonNumber === seasonNumber)) return null;
  return {
    seasonNumber,
    events: buildSeasonEvents(world, seasonNumber),
    labels: buildSeasonHistoryLabels(world, seasonNumber),
  };
}
