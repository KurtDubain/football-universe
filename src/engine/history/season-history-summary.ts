import type { SeasonRecord, Trophy } from '../../types/team';
import { archivedStoryConclusion, formatLeagueTransition, getLeagueName } from '../../utils/format';
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
  linkGroups?: Array<{
    label: string;
    links: SeasonHistoryLink[];
  }>;
  replayStatus?: 'available' | 'summary_only';
}

export interface SeasonHistoryLabel {
  id: string;
  type: 'dynasty' | 'drought' | 'longevity' | 'promotion_run' | 'relegation_run' | 'decline';
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
/**
 * Same-tier decline has to be a collapse, not a drift. Top-flight positions
 * move about four places season to season, so three ordinary steps down
 * cleared the old >= 4 bar by chance alone: the label fired ~2.7 times a
 * season across a 150-season audit and crowded out every rarer signal.
 */
export const DECLINE_MIN_POSITION_DROP = 8;
/**
 * Long arcs only speak at milestones. Without this a twelve-season drought
 * would reprint itself every season and become exactly the standing noise
 * the season review is meant to avoid.
 */
export const DROUGHT_MILESTONES = [15, 20, 25, 30, 40, 50] as const;
export const LONGEVITY_MILESTONES = [10, 15, 20, 25, 30, 40] as const;

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

function seasonStoryGroups(
  history: Storyline[] | undefined,
  seasonNumber: number,
): Storyline[][] {
  const stories = (history ?? [])
    .filter(storyline =>
      storyline.seasonNumber === seasonNumber
      && storyline.phase === '落幕'
      && Boolean(storyline.conclusion),
    )
    .sort((a, b) =>
      Number(b.outcome === 'success') - Number(a.outcome === 'success')
      || (b.endedWindow ?? b.lastUpdatedWindow) - (a.endedWindow ?? a.lastUpdatedWindow)
      || a.id.localeCompare(b.id),
    );
  const grouped = new Map<StorylineType, Storyline[]>();
  for (const story of stories) {
    grouped.set(story.type, [...(grouped.get(story.type) ?? []), story]);
  }
  return [...grouped.values()].slice(0, 2);
}

function movementLinkGroups(
  world: Pick<GameWorld, 'teamBases'>,
  entries: Array<{ teamId: string; from: number; to: number }>,
  direction: '升级' | '降级',
): NonNullable<SeasonHistoryEvent['linkGroups']> {
  const groups = new Map<string, SeasonHistoryLink[]>();
  for (const entry of entries) {
    const label = `${direction} · ${formatLeagueTransition(entry.from, entry.to)}`;
    groups.set(label, [...(groups.get(label) ?? []), teamLink(world, entry.teamId)]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([label, links]) => ({ label, links: uniqueLinks(links) }));
}

/** A season review row has to earn its place; these are the bars it must clear. */
export const DEVIATION_MAX_ACTUAL_PROBABILITY = 15;
export const MOVEMENT_NOTABLE_EXPECTATION = 4;
export const MOVEMENT_YOYO_LOOKBACK_SEASONS = 1;

function championOf(
  record: GameWorld['honorHistory'][number] | undefined,
  level: 1 | 2 | 3,
): string | undefined {
  if (!record) return undefined;
  if (level === 1) return record.league1Champion;
  if (level === 2) return record.league2Champion;
  return record.league3Champion;
}

function levelOfTeam(
  world: Pick<GameWorld, 'teamSeasonRecords'>,
  teamId: string,
  seasonNumber: number,
): number | undefined {
  return world.teamSeasonRecords[teamId]
    ?.find(record => record.seasonNumber === seasonNumber)?.leagueLevel;
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

  // Story endings are the only rows that describe something that actually
  // happened to a club, so they go first and can never be truncated away.
  const storyEvents: SeasonHistoryEvent[] = [];
  for (const stories of seasonStoryGroups(world.storylineHistory, seasonNumber)) {
    const storyline = stories[0];
    const names = stories.map(story => teamName(world, story.teamId));
    storyEvents.push({
      id: `S${seasonNumber}-story-${storyline.type}`,
      type: 'story',
      title: `${names.join('、')}：${STORY_LABELS[storyline.type]}落幕`,
      detail: stories.map(story => (
        `${teamName(world, story.teamId)}：${archivedStoryConclusion(story.conclusion ?? story.evidence.join(' · '))}`
      )).join('；'),
      links: uniqueLinks(stories.map(story => teamLink(world, story.teamId))),
    });
  }

  const factEvents: SeasonHistoryEvent[] = [];
  const previousHonor = world.honorHistory.find(record => record.seasonNumber === seasonNumber - 1);

  // Titles: a first crown or a successful defence is a story. A routine change
  // of champion is already on the honours board and needs no narrative row.
  const tiers = [
    { level: 1 as const, champion: honor.league1Champion, label: '顶级联赛' },
    { level: 2 as const, champion: honor.league2Champion, label: '甲级联赛' },
    { level: 3 as const, champion: honor.league3Champion, label: '乙级联赛' },
  ];
  const notableTitles = tiers.flatMap(tier => {
    if (!tier.champion) return [];
    const wonBefore = world.honorHistory
      .filter(record => record.seasonNumber < seasonNumber)
      .some(record => championOf(record, tier.level) === tier.champion);
    const defended = championOf(previousHonor, tier.level) === tier.champion;
    if (wonBefore && !defended) return [];
    return [{ ...tier, defended }];
  });
  if (notableTitles.length > 0) {
    const topTitle = notableTitles.find(tier => tier.level === 1);
    const championRecord = topTitle
      ? world.teamSeasonRecords[topTitle.champion]?.find(record => record.seasonNumber === seasonNumber)
      : undefined;
    const championCoach = championRecord ? world.coachBases[championRecord.coachId] : undefined;
    const links = notableTitles.map(tier => teamLink(world, tier.champion, tier.label));
    if (championRecord && championCoach) {
      links.push({
        label: `冠军主帅 · ${championCoach.name}`,
        to: `/coach/${championRecord.coachId}`,
        kind: 'coach',
      });
    }
    factEvents.push({
      id: `S${seasonNumber}-league`,
      type: 'league',
      title: notableTitles
        .map(tier => `${teamName(world, tier.champion)}${tier.defended ? '卫冕' : '首夺'}${tier.label}`)
        .join('，'),
      detail: `${notableTitles
        .map(tier => (
          tier.defended
            ? `${teamName(world, tier.champion)}连续第二个赛季夺得${tier.label}冠军`
            : `${teamName(world, tier.champion)}拿到队史首个${tier.label}冠军`
        ))
        .join('；')}。`,
      links: uniqueLinks(links),
    });
  }

  // Cups: only a multi-trophy season or a winner from outside the top flight.
  const cupWinners = seasonCupWinners(world, seasonNumber);
  const trophyCount = new Map<string, number>();
  const countTrophy = (teamId: string | undefined) => {
    if (teamId) trophyCount.set(teamId, (trophyCount.get(teamId) ?? 0) + 1);
  };
  for (const winner of cupWinners) countTrophy(winner.teamId);
  countTrophy(honor.league1Champion);
  countTrophy(honor.league2Champion);
  countTrophy(honor.league3Champion);
  const multiTrophy = [...trophyCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lowerTierWinners = cupWinners.filter(winner => (
    levelOfTeam(world, winner.teamId, seasonNumber) ?? 1
  ) > 1);
  if (multiTrophy.length > 0) {
    factEvents.push({
      id: `S${seasonNumber}-cups`,
      type: 'cups',
      title: multiTrophy
        .map(([teamId, count]) => `${teamName(world, teamId)}单季${count}冠`)
        .join('，'),
      detail: `${multiTrophy
        .map(([teamId, count]) => `${teamName(world, teamId)}本季拿下${count}座冠军奖杯`)
        .join('；')}。`,
      links: uniqueLinks(multiTrophy.map(([teamId]) => teamLink(world, teamId))),
    });
  } else if (lowerTierWinners.length > 0) {
    const winner = lowerTierWinners[0];
    const level = levelOfTeam(world, winner.teamId, seasonNumber) ?? 1;
    factEvents.push({
      id: `S${seasonNumber}-cups`,
      type: 'cups',
      title: `${teamName(world, winner.teamId)}爆冷夺得${CUP_LABELS[winner.type]}`,
      detail: `${teamName(world, winner.teamId)}本季在${getLeagueName(level)}征战，却拿下了${CUP_LABELS[winner.type]}。`,
      links: uniqueLinks([teamLink(world, winner.teamId)]),
    });
  }

  // Movement: three up and three down happens every season. Only a giant
  // falling or a club bouncing straight back is worth a row.
  // Only a top-flight giant counts: a big club dropping out of the second
  // tier is a bad season, not a change to the landscape.
  const relegatedGiants = honor.relegated.filter(entry => (
    entry.from === 1
    && (world.teamBases[entry.teamId]?.expectation ?? 0) >= MOVEMENT_NOTABLE_EXPECTATION
  ));
  const recentHonors = world.honorHistory.filter(record => (
    record.seasonNumber < seasonNumber
    && record.seasonNumber >= seasonNumber - MOVEMENT_YOYO_LOOKBACK_SEASONS
  ));
  const bouncedBack = honor.promoted.filter(entry => recentHonors.some(record => (
    record.relegated.some(drop => drop.teamId === entry.teamId)
  )));
  if (relegatedGiants.length > 0 || bouncedBack.length > 0) {
    const linkGroups = [
      ...movementLinkGroups(world, bouncedBack, '升级'),
      ...movementLinkGroups(world, relegatedGiants, '降级'),
    ];
    const titleParts: string[] = [];
    if (relegatedGiants.length > 0) {
      titleParts.push(`${relegatedGiants.map(entry => teamName(world, entry.teamId)).join('、')}降级`);
    }
    if (bouncedBack.length > 0) {
      titleParts.push(`${bouncedBack.map(entry => teamName(world, entry.teamId)).join('、')}迅速升回`);
    }
    const detailParts: string[] = [];
    if (relegatedGiants.length > 0) {
      detailParts.push(relegatedGiants
        .map(entry => `${teamName(world, entry.teamId)}赛前被看好，却从${getLeagueName(entry.from)}跌入${getLeagueName(entry.to)}`)
        .join('；'));
    }
    if (bouncedBack.length > 0) {
      detailParts.push(bouncedBack
        .map(entry => `${teamName(world, entry.teamId)}降级后很快回到${getLeagueName(entry.to)}`)
        .join('；'));
    }
    factEvents.push({
      id: `S${seasonNumber}-movement`,
      type: 'movement',
      title: titleParts.join('，'),
      detail: `${detailParts.join('；')}。`,
      links: linkGroups.flatMap(group => group.links),
      linkGroups,
    });
  }

  // The season's biggest deviation only counts when it was genuinely unlikely.
  const trajectory = (world.observerSeasonTrajectories ?? [])
    .find(entry => entry.seasonNumber === seasonNumber);
  const deviation = trajectory?.destinyDeviation;
  if (deviation && deviation.actualProbability <= DEVIATION_MAX_ACTUAL_PROBABILITY) {
    const replayAvailable = (world.memorableMatches ?? [])
      .some(entry => entry.result.fixtureId === deviation.fixtureId);
    factEvents.push({
      id: `S${seasonNumber}-deviation`,
      type: 'deviation',
      title: `${teamName(world, deviation.homeTeamId)} ${deviation.homeGoals}-${deviation.awayGoals} ${teamName(world, deviation.awayTeamId)}：本季最大冷门`,
      detail: [
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

  // A representative player only earns a row by repeating an award or by
  // sweeping several in one season.
  const awards = (world.playerAwardsHistory ?? []).filter(item => item.season === seasonNumber);
  const priorAwards = (world.playerAwardsHistory ?? []).filter(item => item.season === seasonNumber - 1);
  const awardCounts = new Map<string, number>();
  for (const item of awards) {
    awardCounts.set(item.playerId, (awardCounts.get(item.playerId) ?? 0) + 1);
  }
  const notableAwards = awards.filter(item => (
    priorAwards.some(prev => prev.playerId === item.playerId && prev.type === item.type)
    || (awardCounts.get(item.playerId) ?? 0) >= 2
  ));
  const personAward = notableAwards.sort((a, b) => (
    (AWARD_PRIORITY[b.type] ?? 0) - (AWARD_PRIORITY[a.type] ?? 0)
    || b.statValue - a.statValue
    || a.playerId.localeCompare(b.playerId)
  ))[0];
  if (personAward) {
    const repeated = priorAwards.some(prev => (
      prev.playerId === personAward.playerId && prev.type === personAward.type
    ));
    const count = awardCounts.get(personAward.playerId) ?? 1;
    factEvents.push({
      id: `S${seasonNumber}-person`,
      type: 'person',
      title: repeated
        ? `${personAward.playerName}蝉联个人荣誉`
        : `${personAward.playerName}单季包揽${count}项荣誉`,
      detail: repeated
        ? `${personAward.playerName}连续第二个赛季拿到${personAward.statLabel}。`
        : `${personAward.playerName}本季同时拿下${count}项个人奖项，其中${personAward.statLabel}最具代表性。`,
      links: [
        {
          label: personAward.playerName,
          to: `/player/${personAward.playerId}`,
          kind: 'player',
        },
        teamLink(world, personAward.teamId),
      ],
    });
  }

  return [...storyEvents, ...factEvents].slice(0, MAX_SEASON_HISTORY_EVENTS);
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

/** Team count for a double round-robin season row. */
function teamCountOf(record: SeasonRecord): number {
  return Math.max(2, Math.round(record.leaguePlayed / 2) + 1);
}

function isMilestone(value: number, milestones: readonly number[]): boolean {
  return milestones.includes(value);
}

/**
 * Consecutive top-flight seasons ending at `seasonNumber`. A gap in the
 * retained record window ends the run, so the count is a lower bound and can
 * never overstate a club's tenure.
 */
function topFlightRunLength(records: SeasonRecord[], seasonNumber: number): number {
  const levelBySeason = new Map(records.map(record => [record.seasonNumber, record.leagueLevel]));
  let length = 0;
  for (let season = seasonNumber; season >= 1; season--) {
    if (levelBySeason.get(season) !== 1) break;
    length++;
  }
  return length;
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
    // Dropping a level is a decline on its own. Staying in the same tier only
    // counts when a contender fell a long way, so a mid-table side sliding
    // into the relegation places stops registering as a story.
    const startedInTopHalf = first.leaguePosition <= teamCountOf(first) / 2;
    const substantial = last.leagueLevel > first.leagueLevel
      || (startedInTopHalf
        && last.leaguePosition - first.leaguePosition >= DECLINE_MIN_POSITION_DROP);
    if (!substantial) continue;
    labels.push({
      id: `S${seasonNumber}-decline-${teamId}`,
      type: 'decline',
      title: `${teamName(world, teamId)}连续${length}季滑落`,
      detail: `S${first.seasonNumber}的${getLeagueName(first.leagueLevel)}第${first.leaguePosition}，降至S${last.seasonNumber}的${getLeagueName(last.leagueLevel)}第${last.leaguePosition}。`,
      teamId,
    });
  }
  return labels;
}

/**
 * Seasons since a current top-flight club last won the top division, measured
 * from the retained record window when the club has never won. Both branches
 * are lower bounds: the window is capped at 40 seasons per team, so a longer
 * real drought is reported short rather than overstated.
 */
function droughtLabels(
  world: Pick<GameWorld, 'honorHistory' | 'teamSeasonRecords' | 'teamBases'>,
  seasonNumber: number,
): SeasonHistoryLabel[] {
  const labels: SeasonHistoryLabel[] = [];
  const honors = world.honorHistory.filter(record => record.seasonNumber <= seasonNumber);
  for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
    const current = records.find(record => record.seasonNumber === seasonNumber);
    if (!current || current.leagueLevel !== 1) continue;
    const topFlightSeasons = records
      .filter(record => record.leagueLevel === 1)
      .map(record => record.seasonNumber);
    if (topFlightSeasons.length === 0) continue;
    const titleSeasons = honors
      .filter(record => record.league1Champion === teamId)
      .map(record => record.seasonNumber);
    const lastTitle = titleSeasons.length > 0 ? Math.max(...titleSeasons) : undefined;
    const firstTopFlight = Math.min(...topFlightSeasons);
    const drought = seasonNumber - (lastTitle ?? firstTopFlight - 1);
    if (!isMilestone(drought, DROUGHT_MILESTONES)) continue;
    labels.push({
      id: `S${seasonNumber}-drought-${teamId}`,
      type: 'drought',
      title: lastTitle === undefined
        ? `${teamName(world, teamId)}自S${firstTopFlight}起${drought}季未夺顶级联赛冠军`
        : `${teamName(world, teamId)}自S${lastTitle}夺冠后${drought}季未再登顶`,
      detail: lastTitle === undefined
        ? `这${drought}个赛季里始终没有拿到顶级联赛冠军。`
        : `上一次顶级联赛冠军是S${lastTitle}，此后${drought}季未再夺冠。`,
      teamId,
    });
  }
  return labels;
}

function longevityLabels(
  world: Pick<GameWorld, 'teamSeasonRecords' | 'teamBases'>,
  seasonNumber: number,
): SeasonHistoryLabel[] {
  const labels: SeasonHistoryLabel[] = [];
  for (const [teamId, records] of Object.entries(world.teamSeasonRecords)) {
    const length = topFlightRunLength(records, seasonNumber);
    if (!isMilestone(length, LONGEVITY_MILESTONES)) continue;
    labels.push({
      id: `S${seasonNumber}-longevity-${teamId}`,
      type: 'longevity',
      title: `${teamName(world, teamId)}连续${length}季立足顶级联赛`,
      detail: `S${seasonNumber - length + 1}至S${seasonNumber}连续${length}季留在顶级联赛。`,
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

  labels.push(...droughtLabels(world, seasonNumber));
  labels.push(...longevityLabels(world, seasonNumber));
  labels.push(...declineLabels(world, seasonNumber));
  // This season's movement outranks a slow-burn milestone: a club that just
  // dropped a level should not be hidden behind another club's title drought.
  const priority: Record<SeasonHistoryLabel['type'], number> = {
    dynasty: 6,
    relegation_run: 5,
    promotion_run: 4,
    drought: 3,
    longevity: 2,
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
