import type { SuperCupGroup } from '../../types/cup';
import { PLAYER_AWARD_LABELS } from '../players/player-honors';
import type { GameWorld } from './season-manager';

/**
 * The season-opening window's content, derived from world state at render
 * time.
 *
 * Pure: no RNG, no mutation, no new persisted fields. That is deliberate —
 * the opening window exists only because this can be recomputed from state
 * the world already holds, so adding the window moves no seeded result and
 * needs no save migration.
 */

/** A club as it appears in an opening draw table. */
export interface OpeningTeam {
  teamId: string;
  name: string;
  shortName: string;
  overall: number;
  level: 1 | 2 | 3;
}

export interface OpeningGroup {
  groupName: string;
  teams: OpeningTeam[];
  /** Set only on the groups actually worth calling out. */
  note?: string;
}

export interface OpeningPairing {
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  roundLabel: string;
  /** League-level gap across the tie; drives the mismatch callout. */
  levelGap: number;
}

export interface OpeningDraw {
  key: string;
  title: string;
  rule: string;
  groups: OpeningGroup[];
  pairings: OpeningPairing[];
  /** One line naming what is worth watching in this draw. */
  highlight?: string;
}

export type OpeningTone = 'stage' | 'rise' | 'fall' | 'legacy' | 'transfer';

export interface OpeningStoryline {
  key: string;
  tone: OpeningTone;
  title: string;
  detail: string;
  teamId?: string;
  playerId?: string;
  coachId?: string;
}

export interface SeasonOpening {
  seasonNumber: number;
  draws: OpeningDraw[];
  storylines: OpeningStoryline[];
}

const LEVEL_LABELS: Record<1 | 2 | 3, string> = { 1: '顶级', 2: '甲级', 3: '乙级' };

// Thresholds from docs/cup-draw-redesign.md section 5. A super cup group is
// judged on its full spread because its pots are seeded by qualification
// rank; world and continental groups are judged on the top-two gap because
// their pot structure already guarantees a wide spread.
const DEATH_GROUP_SPREAD = 6;
const DEATH_GROUP_TOP_GAP = 3;
const RUNAWAY_TOP_GAP = 12;
/** Annotate at most this many groups so an eight-group draw is not all noise. */
const MAX_GROUP_NOTES = 2;

function teamRef(world: GameWorld, teamId: string): OpeningTeam {
  const base = world.teamBases[teamId];
  const level = (world.teamStates[teamId]?.leagueLevel
    ?? base?.initialLeagueLevel
    ?? 1) as 1 | 2 | 3;
  return {
    teamId,
    name: base?.name ?? teamId,
    shortName: base?.shortName ?? base?.name ?? teamId,
    overall: base?.overall ?? 0,
    level,
  };
}

function overallsOf(teams: OpeningTeam[]): number[] {
  return teams.map(team => team.overall).sort((a, b) => b - a);
}

function groupNote(teams: OpeningTeam[], mode: 'spread' | 'topGap'): string | undefined {
  if (teams.length < 2) return undefined;
  const overalls = overallsOf(teams);
  const spread = overalls[0] - overalls[overalls.length - 1];
  const topGap = overalls[0] - overalls[1];
  if (mode === 'spread') {
    if (spread < DEATH_GROUP_SPREAD) return `死亡之组 · 极差 ${spread}`;
    if (topGap > RUNAWAY_TOP_GAP) return `一枝独秀 · 领先 ${topGap}`;
    return undefined;
  }
  if (topGap < DEATH_GROUP_TOP_GAP) return `前二仅差 ${topGap}`;
  if (topGap > RUNAWAY_TOP_GAP) return `一枝独秀 · 领先 ${topGap}`;
  return undefined;
}

function buildGroupDraw(
  world: GameWorld,
  key: string,
  title: string,
  rule: string,
  groups: SuperCupGroup[],
  mode: 'spread' | 'topGap',
): OpeningDraw | null {
  if (groups.length === 0) return null;
  const built = groups.map(group => {
    // Strongest first. The pot order the draw produced is already explained by
    // the `rule` line, and an OVR column that is not descending reads like a
    // rendering bug rather than a pot assignment.
    const teams = group.teamIds
      .map(id => teamRef(world, id))
      .sort((a, b) => b.overall - a.overall);
    return { groupName: group.groupName, teams, note: groupNote(teams, mode) };
  });

  // Keep only the tightest annotated groups. Eight groups all flagged is
  // indistinguishable from none flagged.
  const ranked = built
    .map((group, index) => {
      const overalls = overallsOf(group.teams);
      return {
        index,
        note: group.note,
        spread: overalls.length > 1 ? overalls[0] - overalls[overalls.length - 1] : 0,
      };
    })
    .filter(entry => Boolean(entry.note))
    .sort((a, b) => a.spread - b.spread || a.index - b.index)
    .slice(0, MAX_GROUP_NOTES);
  const kept = new Set(ranked.map(entry => entry.index));
  const finalGroups: OpeningGroup[] = built.map((group, index) => (
    kept.has(index) ? group : { groupName: group.groupName, teams: group.teams }
  ));

  const noted = ranked.map(entry => built[entry.index]);
  const highlight = noted.length > 0
    ? noted.map(group => `${group.groupName}组 ${group.note}`).join('；') + '。'
    : undefined;

  return { key, title, rule, groups: finalGroups, pairings: [], highlight };
}

function buildLeagueCupDraw(world: GameWorld): OpeningDraw | null {
  const round = world.leagueCup.rounds[0];
  if (!round || round.fixtures.length === 0) return null;
  const pairings: OpeningPairing[] = round.fixtures.map(fixture => {
    const home = teamRef(world, fixture.homeTeamId);
    const away = teamRef(world, fixture.awayTeamId);
    return {
      homeId: home.teamId,
      awayId: away.teamId,
      homeName: home.shortName,
      awayName: away.shortName,
      roundLabel: fixture.roundName,
      levelGap: Math.abs(home.level - away.level),
    };
  });
  const cross = pairings.filter(pairing => pairing.levelGap >= 2);
  return {
    key: 'league_cup',
    title: `联赛杯 ${round.roundName}`,
    rule: '32 队单场淘汰 · 全中立场 · 纯随机',
    groups: [],
    pairings,
    highlight: cross.length > 0
      ? `${cross.length} 组跨级对阵，最大级别差出现在 ${cross[0].homeName} vs ${cross[0].awayName}。`
      : undefined,
  };
}

function titleStreak(world: GameWorld, teamId: string, fromSeason: number): number {
  let streak = 0;
  for (let season = fromSeason; season >= 1; season--) {
    const honor = world.honorHistory.find(row => row.seasonNumber === season);
    if (honor?.league1Champion !== teamId) break;
    streak++;
  }
  return streak;
}

function buildStorylines(
  world: GameWorld,
  favoriteTeamIds: readonly string[],
): OpeningStoryline[] {
  const season = world.seasonState.seasonNumber;
  const previous = world.honorHistory.find(row => row.seasonNumber === season - 1);
  const items: OpeningStoryline[] = [];
  const name = (id: string) => world.teamBases[id]?.name ?? id;

  if (previous?.league1Champion) {
    const champion = previous.league1Champion;
    const record = world.teamSeasonRecords[champion]?.find(row => row.seasonNumber === season - 1);
    const streak = titleStreak(world, champion, season - 1);
    items.push({
      key: 'defending-champion',
      tone: 'stage',
      title: `${name(champion)}以卫冕者身份开启新赛季`,
      detail: record
        ? `S${season - 1} 以 ${record.leaguePoints} 分夺冠${streak > 1 ? `，已连续 ${streak} 季夺冠` : ''}。`
        : `S${season - 1} 顶级联赛冠军。`,
      teamId: champion,
    });
  } else {
    // S1 has no archive to read, so the only honest pre-season read is the
    // one the numbers already state.
    const strongest = Object.values(world.teamBases)
      .slice()
      .sort((a, b) => b.overall - a.overall)[0];
    if (strongest) {
      items.push({
        key: 'paper-favourite',
        tone: 'stage',
        title: `${strongest.name}是账面最强的一队`,
        detail: `OVR ${strongest.overall}，全联盟最高。首个赛季没有历史可参照，纸面实力是唯一的起点。`,
        teamId: strongest.id,
      });
    }
  }

  const promotedToTop = (previous?.promoted ?? []).filter(row => row.to === 1);
  if (promotedToTop.length > 0) {
    items.push({
      key: 'promoted',
      tone: 'rise',
      title: `${promotedToTop.map(row => name(row.teamId)).join('、')}升入顶级联赛`,
      detail: `${promotedToTop
        .map(row => `${name(row.teamId)} ${LEVEL_LABELS[row.from as 1 | 2 | 3]}→${LEVEL_LABELS[row.to as 1 | 2 | 3]}`)
        .join('；')}。升班马的首个顶级赛季通常就决定他们能不能站稳。`,
      teamId: promotedToTop[0].teamId,
    });
  }

  const changes = previous?.coachChanges ?? [];
  if (changes.length > 0) {
    items.push({
      key: 'coach-changes',
      tone: 'fall',
      title: `休赛期 ${changes.length} 支球队更换主教练`,
      detail: `${changes.slice(0, 3).map(change => {
        const from = world.coachBases[change.oldCoachId]?.name ?? change.oldCoachId;
        const to = world.coachBases[change.newCoachId]?.name ?? change.newCoachId;
        return `${name(change.teamId)} ${from} → ${to}（${change.reason}）`;
      }).join('；')}。`,
      teamId: changes[0].teamId,
      coachId: changes[0].newCoachId,
    });
  }

  const windowTransfers = (world.transferHistory ?? [])
    .filter(row => row.season === season - 1 || row.season === season);
  const biggest = windowTransfers.slice().sort((a, b) => (b.fee ?? 0) - (a.fee ?? 0))[0];
  if (biggest && (biggest.fee ?? 0) > 0) {
    items.push({
      key: 'transfer',
      tone: 'transfer',
      title: `${biggest.playerName}以 €${biggest.fee}M 成为窗口标王`,
      detail: `${biggest.fromTeamName} → ${biggest.toTeamName} · ${biggest.reason}。`,
      teamId: biggest.toTeamId,
      playerId: biggest.playerId,
    });
  }

  const awards = (world.playerAwardsHistory ?? [])
    .filter(row => row.season === season - 1 && row.type !== 'young_player');
  const mvp = awards.find(row => row.type === 'mvp');
  const boot = awards.find(row => row.type === 'golden_boot');
  if (mvp || boot) {
    const parts: string[] = [];
    if (mvp) parts.push(`${PLAYER_AWARD_LABELS.mvp} ${mvp.playerName}（${mvp.teamName}）`);
    if (boot) parts.push(`${PLAYER_AWARD_LABELS.golden_boot} ${boot.playerName}（${boot.teamName} · ${boot.statLabel}）`);
    items.push({
      key: 'awards',
      tone: 'stage',
      title: '上季个人荣誉得主',
      detail: `${parts.join('；')}。新赛季他们从被追赶的位置出发。`,
      playerId: (mvp ?? boot)!.playerId,
    });
  }

  const retired = (world.retirementHistory ?? [])
    .filter(row => row.seasonRetired === season - 1)
    .sort((a, b) => b.peakRating - a.peakRating);
  if (retired.length > 0) {
    items.push({
      key: 'retirements',
      tone: 'legacy',
      title: `${retired.length} 名球员在休赛期退役`,
      detail: `${retired.slice(0, 3)
        .map(row => `${row.name}（${row.teamName} · 峰值 ${row.peakRating} · 生涯 ${row.careerGoals} 球）`)
        .join('；')}。`,
      teamId: retired[0].teamId,
      playerId: retired[0].uuid,
    });
  }

  const favorite = favoriteTeamIds[0];
  if (favorite) {
    const base = world.teamBases[favorite];
    const level = (world.teamStates[favorite]?.leagueLevel ?? base?.initialLeagueLevel ?? 1) as 1 | 2 | 3;
    const record = world.teamSeasonRecords[favorite]?.find(row => row.seasonNumber === season - 1);
    items.push({
      key: 'favorite',
      tone: 'stage',
      title: `${base?.name ?? favorite}的新赛季`,
      detail: record
        ? `上季 ${LEVEL_LABELS[level]}联赛第 ${record.leaguePosition} 名（${record.leaguePoints} 分），本季 OVR ${base?.overall ?? 0}。`
        : `${LEVEL_LABELS[level]}联赛，本季 OVR ${base?.overall ?? 0}。`,
      teamId: favorite,
    });
  }

  return items;
}

/**
 * Build the season-opening read: every draw this season has already had,
 * plus what the offseason changed.
 *
 * Safe to call in any window; it only reads state. The UI calls it while
 * the current window is `pre_season`.
 */
export function buildSeasonOpening(
  world: GameWorld,
  options: { favoriteTeamIds?: readonly string[] } = {},
): SeasonOpening {
  const seasonNumber = world.seasonState.seasonNumber;
  const draws: OpeningDraw[] = [];

  const leagueCup = buildLeagueCupDraw(world);
  if (leagueCup) draws.push(leagueCup);

  const superCup = buildGroupDraw(
    world,
    'super_cup',
    '超级杯小组赛',
    '16 队 · 按参赛排位分 4 档，每组各档取 1 队',
    world.superCup.groups,
    'spread',
  );
  if (superCup) draws.push(superCup);

  for (const cup of [
    world.continentalCups.mainland_cup,
    world.continentalCups.southern_cup,
    world.continentalCups.eastern_cup,
  ]) {
    if (!cup) continue;
    const draw = buildGroupDraw(
      world,
      `continental:${cup.type}`,
      `${cup.name}小组赛`,
      `${cup.region} · 按俱乐部系数分 4 档，每组各档取 1 队`,
      cup.groups,
      'topGap',
    );
    if (draw) draws.push(draw);
  }

  if (world.worldCup) {
    const draw = buildGroupDraw(
      world,
      'world_cup',
      '环球冠军杯小组赛',
      '32 队 · 按实力排位分 4 档，每组各档取 1 队',
      world.worldCup.groups,
      'topGap',
    );
    if (draw) draws.push(draw);
  }

  return {
    seasonNumber,
    draws,
    storylines: buildStorylines(world, options.favoriteTeamIds ?? []),
  };
}
