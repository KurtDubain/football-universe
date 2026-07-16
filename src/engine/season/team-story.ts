import type { GameWorld } from './season-manager';
import { formatMoney } from '../economy/finance';

export type TeamStoryTone = 'amber' | 'emerald' | 'red' | 'blue' | 'slate';
export type TeamStoryMomentKind = 'trophy' | 'transition' | 'match' | 'coach' | 'transfer';

export interface TeamStoryChapter {
  title: string;
  summary: string;
  tone: TeamStoryTone;
  signals: string[];
}

export interface TeamStoryMoment {
  id: string;
  season: number;
  windowIndex: number;
  kind: TeamStoryMomentKind;
  title: string;
  detail: string;
  linkTo?: string;
}

export interface TeamStoryRivalry {
  opponentId: string;
  opponentName: string;
  meetings: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  label: string;
  latest: string;
}

export interface TeamStory {
  chapter: TeamStoryChapter;
  moments: TeamStoryMoment[];
  rivalry: TeamStoryRivalry | null;
}

const TROPHY_LABELS: Record<string, string> = {
  league1: '顶级联赛',
  league2: '甲级联赛',
  league3: '乙级联赛',
  league_cup: '联赛杯',
  super_cup: '超级杯',
  world_cup: '环球冠军杯',
  mainland_cup: '大陆杯',
  southern_cup: '南洲杯',
  eastern_cup: '东洲杯',
};

function standingsFor(world: GameWorld, level: 1 | 2 | 3) {
  if (level === 1) return world.league1Standings;
  if (level === 2) return world.league2Standings;
  return world.league3Standings;
}

function formSummary(form: Array<'W' | 'D' | 'L'>): string {
  const wins = form.filter(result => result === 'W').length;
  const draws = form.filter(result => result === 'D').length;
  const losses = form.filter(result => result === 'L').length;
  return `近${form.length}场 ${wins}胜${draws}平${losses}负`;
}

function trailingStreak(form: Array<'W' | 'D' | 'L'>, result: 'W' | 'L'): number {
  let count = 0;
  for (let index = form.length - 1; index >= 0 && form[index] === result; index--) count++;
  return count;
}

function deriveChapter(world: GameWorld, teamId: string): TeamStoryChapter {
  const team = world.teamBases[teamId];
  const state = world.teamStates[teamId];
  const records = world.teamSeasonRecords[teamId] ?? [];
  const latestRecord = records.at(-1);
  const finance = world.teamFinances[teamId];
  const standings = state ? standingsFor(world, state.leagueLevel) : [];
  const standingIndex = standings.findIndex(row => row.teamId === teamId);
  const standing = standingIndex >= 0 ? standings[standingIndex] : undefined;
  const rank = standingIndex >= 0 ? standingIndex + 1 : 0;
  const recentForm = state?.recentForm ?? [];
  const trophies = world.teamTrophies[teamId] ?? [];
  const wins = trailingStreak(recentForm, 'W');
  const losses = trailingStreak(recentForm, 'L');
  const lastTwoHonors = world.honorHistory.slice(-2);
  const defendingChampion = world.honorHistory.at(-1)?.league1Champion === teamId;
  const dynasty = lastTwoHonors.length === 2
    && lastTwoHonors.every(honor => honor.league1Champion === teamId);
  const signals: string[] = [];

  if (standing && standing.played > 0) signals.push(`联赛第${rank} · ${standing.points}分`);
  if (recentForm.length > 0) signals.push(formSummary(recentForm));
  if (finance) signals.push(`现金 ${formatMoney(finance.cash)}`);
  if (signals.length < 3 && trophies.length > 0) {
    signals.push(`队史 ${trophies.length} 冠`);
  }

  if (defendingChampion && finance?.cash !== undefined && finance.cash < 0) {
    return {
      title: '王冠下的危机',
      summary: `${team.name}仍站在卫冕者的位置上，但财政赤字让每一次补强和续航都变得更加艰难。`,
      tone: 'red',
      signals,
    };
  }
  if (dynasty) {
    return {
      title: '王朝守擂',
      summary: `${team.name}已经连续两个赛季统治顶级联赛，现在所有挑战者都在等待终结这段王朝。`,
      tone: 'amber',
      signals,
    };
  }
  if (finance?.cash !== undefined && finance.cash < 0) {
    return {
      title: '财政风暴',
      summary: `${team.name}正处于赤字之中，成绩、阵容价值与转会选择将共同决定球队能否平稳脱困。`,
      tone: 'red',
      signals,
    };
  }
  if (latestRecord?.relegated) {
    return {
      title: '降级后的重建',
      summary: `${team.name}刚刚经历降级。保住骨架、稳定更衣室并尽快重返原有舞台，是新赛季的主线。`,
      tone: 'red',
      signals,
    };
  }
  if (latestRecord?.promoted) {
    return {
      title: '升级后的新挑战',
      summary: `${team.name}带着升级的势头来到更高舞台，每一场胜利都在为站稳脚跟增加筹码。`,
      tone: 'emerald',
      signals,
    };
  }
  if (standing && standing.played >= 4 && rank === 1) {
    return {
      title: defendingChampion ? '卫冕之路' : '领跑争冠',
      summary: `${team.name}目前掌握争冠主动权，但积分榜上的优势仍需要一轮轮兑现。`,
      tone: 'amber',
      signals,
    };
  }
  if (standing && standing.played >= 4 && state && state.leagueLevel <= 2 && rank >= standings.length - 2) {
    return {
      title: '保级警报',
      summary: `${team.name}已经被卷入保级区，接下来面对直接竞争对手的比赛会格外重要。`,
      tone: 'red',
      signals,
    };
  }
  if (wins >= 3) {
    return {
      title: '势头正盛',
      summary: `${team.name}正经历一段${wins}连胜，短期状态已经开始改变球队的赛季预期。`,
      tone: 'emerald',
      signals,
    };
  }
  if (losses >= 3) {
    return {
      title: '寻找转折',
      summary: `${team.name}遭遇${losses}连败，下一场止住下滑比任何长期目标都更迫切。`,
      tone: 'red',
      signals,
    };
  }

  const earlierOverall = records.length >= 3 ? records.at(-3)?.teamOverall : undefined;
  const latestOverall = latestRecord?.teamOverall;
  if (earlierOverall !== undefined && latestOverall !== undefined && latestOverall - earlierOverall >= 3) {
    return {
      title: '悄然崛起',
      summary: `${team.name}近几个赛季的整体实力持续上升，这支球队正在从追赶者变成不可忽视的竞争者。`,
      tone: 'blue',
      signals,
    };
  }

  return {
    title: state?.leagueLevel === 1 && team.expectation >= 4 ? '等待突破' : '稳步前行',
    summary: state?.leagueLevel === 1 && team.expectation >= 4
      ? `${team.name}拥有不低的期待，接下来需要把阵容实力转化为真正有分量的成绩。`
      : `${team.name}的故事仍在积累，每一轮联赛、每一次换帅和每一笔转会都可能成为新的转折。`,
    tone: 'slate',
    signals,
  };
}

function momentOrder(moment: TeamStoryMoment): number {
  return moment.season * 10_000 + moment.windowIndex;
}

function deriveMoments(world: GameWorld, teamId: string): TeamStoryMoment[] {
  const candidates: TeamStoryMoment[] = [];
  const trophiesBySeason = new Map<number, string[]>();
  for (const trophy of world.teamTrophies[teamId] ?? []) {
    const labels = trophiesBySeason.get(trophy.seasonNumber) ?? [];
    labels.push(TROPHY_LABELS[trophy.type] ?? trophy.type);
    trophiesBySeason.set(trophy.seasonNumber, labels);
  }
  for (const [season, labels] of trophiesBySeason) {
    candidates.push({
      id: `trophy-${teamId}-${season}`,
      season,
      windowIndex: 9_999,
      kind: 'trophy',
      title: labels.length > 1 ? `${labels.length}冠赛季` : `捧起${labels[0]}`,
      detail: `第${season}赛季收获${labels.join('、')}。`,
      linkTo: '/chronicle',
    });
  }

  for (const honor of world.honorHistory) {
    const promotion = honor.promoted.find(entry => entry.teamId === teamId);
    const relegation = honor.relegated.find(entry => entry.teamId === teamId);
    if (promotion) {
      candidates.push({
        id: `promotion-${teamId}-${honor.seasonNumber}`,
        season: honor.seasonNumber,
        windowIndex: 9_998,
        kind: 'transition',
        title: '升级成功',
        detail: `从第${promotion.from}级联赛升入第${promotion.to}级联赛。`,
        linkTo: '/chronicle',
      });
    } else if (relegation) {
      candidates.push({
        id: `relegation-${teamId}-${honor.seasonNumber}`,
        season: honor.seasonNumber,
        windowIndex: 9_998,
        kind: 'transition',
        title: '遭遇降级',
        detail: `从第${relegation.from}级联赛降至第${relegation.to}级联赛。`,
        linkTo: '/chronicle',
      });
    }
    for (const change of honor.coachChanges.filter(entry => entry.teamId === teamId)) {
      candidates.push({
        id: `coach-${teamId}-${honor.seasonNumber}-${change.newCoachId}`,
        season: honor.seasonNumber,
        windowIndex: 9_997,
        kind: 'coach',
        title: '教练席换人',
        detail: `${world.coachBases[change.newCoachId]?.name ?? '新任主帅'}接手球队，原因：${change.reason}。`,
        linkTo: `/coach/${change.newCoachId}`,
      });
    }
  }

  for (const change of world.coachChangesThisSeason.filter(entry => entry.teamId === teamId)) {
    candidates.push({
      id: `coach-current-${teamId}-${change.newCoachId}`,
      season: world.seasonState.seasonNumber,
      windowIndex: world.seasonState.currentWindowIndex,
      kind: 'coach',
      title: '赛季中途换帅',
      detail: `${world.coachBases[change.newCoachId]?.name ?? '新任主帅'}接手球队，原因：${change.reason}。`,
      linkTo: `/coach/${change.newCoachId}`,
    });
  }

  for (const transfer of world.transferHistory ?? []) {
    if (transfer.fromTeamId !== teamId && transfer.toTeamId !== teamId) continue;
    const incoming = transfer.toTeamId === teamId;
    const fee = transfer.fee ? `，费用${formatMoney(transfer.fee)}` : '';
    candidates.push({
      id: `transfer-${teamId}-${transfer.season}-${transfer.windowIndex}-${transfer.playerId}-${incoming ? 'in' : 'out'}`,
      season: transfer.season,
      windowIndex: transfer.windowIndex,
      kind: 'transfer',
      title: incoming ? `签下${transfer.playerName}` : `${transfer.playerName}离队`,
      detail: incoming
        ? `从${transfer.fromTeamName}加盟${fee}。`
        : `前往${transfer.toTeamName}${fee}。`,
      linkTo: `/player/${transfer.playerId}`,
    });
  }

  for (const memorable of world.memorableMatches ?? []) {
    const result = memorable.result;
    if (result.homeTeamId !== teamId && result.awayTeamId !== teamId) continue;
    const home = world.teamBases[result.homeTeamId]?.shortName ?? result.homeTeamId;
    const away = world.teamBases[result.awayTeamId]?.shortName ?? result.awayTeamId;
    const homeGoals = result.homeGoals + (result.etHomeGoals ?? 0);
    const awayGoals = result.awayGoals + (result.etAwayGoals ?? 0);
    candidates.push({
      id: `match-${teamId}-${memorable.season}-${memorable.windowIndex}-${result.fixtureId}`,
      season: memorable.season,
      windowIndex: memorable.windowIndex,
      kind: 'match',
      title: memorable.label,
      detail: `${result.competitionName}：${home} ${homeGoals}-${awayGoals} ${away}。`,
      linkTo: '/memorable',
    });
  }

  candidates.sort((a, b) => momentOrder(b) - momentOrder(a));
  const selected: TeamStoryMoment[] = [];
  const selectedIds = new Set<string>();
  const selectedKinds = new Set<TeamStoryMomentKind>();
  for (const moment of candidates) {
    if (selectedKinds.has(moment.kind)) continue;
    selected.push(moment);
    selectedIds.add(moment.id);
    selectedKinds.add(moment.kind);
  }
  selected.sort((a, b) => momentOrder(b) - momentOrder(a));
  if (selected.length < 4) {
    for (const moment of candidates) {
      if (selectedIds.has(moment.id)) continue;
      selected.push(moment);
      selectedIds.add(moment.id);
      if (selected.length === 4) break;
    }
  }
  return selected.sort((a, b) => momentOrder(b) - momentOrder(a)).slice(0, 4);
}

interface RivalryTally {
  opponentId: string;
  meetings: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  closeMatches: number;
  finals: number;
  memorable: number;
  latestOrder: number;
  latest: string;
}

function rivalryLabel(tally: RivalryTally): string {
  if (tally.finals > 0) return '杯赛宿敌';
  if (tally.meetings >= 5 && Math.abs(tally.wins - tally.losses) <= 1) return '势均力敌';
  if (tally.losses >= tally.wins + 2) return '近期苦主';
  if (tally.wins >= tally.losses + 2) return '占据上风';
  return '交锋频繁';
}

function deriveRivalry(world: GameWorld, teamId: string): TeamStoryRivalry | null {
  const tallies = new Map<string, RivalryTally>();
  const memorableFixtureIds = new Set(
    (world.memorableMatches ?? [])
      .filter(entry => entry.result.homeTeamId === teamId || entry.result.awayTeamId === teamId)
      .map(entry => entry.result.fixtureId),
  );

  const addMatch = (params: {
    season: number;
    windowIndex: number;
    fixtureId?: string;
    homeId: string;
    awayId: string;
    homeGoals: number;
    awayGoals: number;
    penaltyHome?: number;
    penaltyAway?: number;
    isFinal?: boolean;
  }) => {
    if (params.homeId !== teamId && params.awayId !== teamId) return;
    const isHome = params.homeId === teamId;
    const opponentId = isHome ? params.awayId : params.homeId;
    const goalsFor = isHome ? params.homeGoals : params.awayGoals;
    const goalsAgainst = isHome ? params.awayGoals : params.homeGoals;
    const penaltyFor = isHome ? params.penaltyHome : params.penaltyAway;
    const penaltyAgainst = isHome ? params.penaltyAway : params.penaltyHome;
    const won = goalsFor > goalsAgainst
      || (goalsFor === goalsAgainst && penaltyFor !== undefined && penaltyAgainst !== undefined && penaltyFor > penaltyAgainst);
    const lost = goalsFor < goalsAgainst
      || (goalsFor === goalsAgainst && penaltyFor !== undefined && penaltyAgainst !== undefined && penaltyFor < penaltyAgainst);
    const order = params.season * 10_000 + params.windowIndex;
    const tally = tallies.get(opponentId) ?? {
      opponentId,
      meetings: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      closeMatches: 0,
      finals: 0,
      memorable: 0,
      latestOrder: -1,
      latest: '',
    };
    tally.meetings++;
    if (won) tally.wins++;
    else if (lost) tally.losses++;
    else tally.draws++;
    tally.goalsFor += goalsFor;
    tally.goalsAgainst += goalsAgainst;
    if (Math.abs(goalsFor - goalsAgainst) <= 1) tally.closeMatches++;
    if (params.isFinal) tally.finals++;
    if (params.fixtureId && memorableFixtureIds.has(params.fixtureId)) tally.memorable++;
    if (order >= tally.latestOrder) {
      const outcome = won ? '胜' : lost ? '负' : '平';
      tally.latestOrder = order;
      tally.latest = `S${params.season} ${goalsFor}-${goalsAgainst} ${outcome}`;
    }
    tallies.set(opponentId, tally);
  };

  for (const match of world.matchHistory ?? []) {
    let penaltyHome: number | undefined;
    let penaltyAway: number | undefined;
    if (match.pen) {
      const [home, away] = match.pen.split('-').map(Number);
      if (Number.isFinite(home) && Number.isFinite(away)) {
        penaltyHome = home;
        penaltyAway = away;
      }
    }
    addMatch({
      season: match.season,
      windowIndex: 0,
      homeId: match.homeId,
      awayId: match.awayId,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      penaltyHome,
      penaltyAway,
    });
  }
  for (const [windowIndex, window] of world.seasonState.calendar.entries()) {
    if (!window.completed) continue;
    for (const result of window.results ?? []) {
      addMatch({
        season: world.seasonState.seasonNumber,
        windowIndex,
        fixtureId: result.fixtureId,
        homeId: result.homeTeamId,
        awayId: result.awayTeamId,
        homeGoals: result.homeGoals + (result.etHomeGoals ?? 0),
        awayGoals: result.awayGoals + (result.etAwayGoals ?? 0),
        penaltyHome: result.penaltyHome,
        penaltyAway: result.penaltyAway,
        isFinal: result.roundLabel === 'Final' || result.roundLabel.includes('决赛'),
      });
    }
  }

  const ranked = [...tallies.values()]
    .filter(tally => tally.meetings >= 2)
    .sort((a, b) => {
      const score = (tally: RivalryTally) => tally.meetings * 2
        + tally.closeMatches * 1.5
        + tally.finals * 4
        + tally.memorable * 3
        + Math.max(0, 2 - Math.abs(tally.wins - tally.losses));
      return score(b) - score(a) || b.latestOrder - a.latestOrder;
    });
  const top = ranked[0];
  if (!top) return null;
  return {
    opponentId: top.opponentId,
    opponentName: world.teamBases[top.opponentId]?.name ?? top.opponentId,
    meetings: top.meetings,
    wins: top.wins,
    draws: top.draws,
    losses: top.losses,
    goalsFor: top.goalsFor,
    goalsAgainst: top.goalsAgainst,
    label: rivalryLabel(top),
    latest: top.latest,
  };
}

export function buildTeamStory(world: GameWorld, teamId: string): TeamStory {
  return {
    chapter: deriveChapter(world, teamId),
    moments: deriveMoments(world, teamId),
    rivalry: deriveRivalry(world, teamId),
  };
}
