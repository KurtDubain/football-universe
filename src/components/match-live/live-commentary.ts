import type { MatchEvent } from '../../types/match';

interface CommentaryContext {
  event: MatchEvent | null;
  minute: number;
  homeScore: number;
  awayScore: number;
  penaltyHomeScore: number;
  penaltyAwayScore: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}

export interface LiveCommentaryEntry {
  id: string;
  minute: number;
  label: string;
  text: string;
  event?: MatchEvent;
}

interface CommentaryHistoryContext {
  events: MatchEvent[];
  currentMinute: number;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}

function scoringContext(context: CommentaryContext, teamName: string): string {
  const { homeScore, awayScore, minute } = context;
  if (homeScore === awayScore) return `${teamName}扳平了比分。`;
  const eventIsHome = context.event?.teamId === context.homeTeamId;
  const scoringTeamLeads = eventIsHome ? homeScore > awayScore : awayScore > homeScore;
  const lead = Math.abs(homeScore - awayScore);
  if (scoringTeamLeads && lead === 1 && minute >= 80) return `${teamName}在比赛末段取得关键领先。`;
  if (scoringTeamLeads && lead === 1) return `${teamName}取得领先。`;
  if (scoringTeamLeads && lead >= 2) return `${teamName}将优势扩大到两球以上。`;
  return '';
}

export function buildLiveCommentary(context: CommentaryContext): string {
  const { event, minute, homeTeamName, awayTeamName } = context;
  if (!event) {
    if (minute < 3) return '比赛开球，双方开始试探。';
    if (minute === 46) return '下半场开始，比赛重新进入节奏。';
    if (minute === 91) return '加时赛开始，双方的每一次选择都更加谨慎。';
    if (minute === 106) return '加时赛下半场开始，比赛进入最后的较量。';
    if (minute >= 85 && minute <= 90) return '比赛进入最后阶段，每一次攻防都可能决定结果。';
    if (minute < 30) return '双方正在争夺中场控制，进攻仍在寻找空间。';
    if (minute < 60) return '比赛节奏逐渐稳定，下一次推进可能形成机会。';
    return '体能和阵型开始影响比赛，场上空间正在增多。';
  }

  const teamName = event.teamId === context.homeTeamId ? homeTeamName : awayTeamName;
  if (event.type === 'penalty_goal' || event.type === 'penalty_miss') {
    const score = `${context.penaltyHomeScore}:${context.penaltyAwayScore}`;
    const stage = event.shootout?.suddenDeath ? '突然死亡' : `第${event.shootout?.round ?? '?'}轮`;
    const keeperDetail = event.shootout?.outcome === 'saved' && event.shootout.goalkeeperName
      ? ` ${event.shootout.goalkeeperName}判断正确。`
      : ' ';
    return `${stage}，${event.description}${keeperDetail}点球比分来到 ${score}。`;
  }
  if (event.type === 'goal' || event.type === 'own_goal') {
    const detail = scoringContext(context, teamName);
    return `${event.description}。${detail}`;
  }
  if (event.type === 'save' || event.type === 'gk_save') return `${event.description}，比分没有改变。`;
  if (event.type === 'df_block') return `${event.description}，这次防守保住了当前比分。`;
  if (event.type === 'miss') return `${event.description}，${teamName}错过了改写比分的机会。`;
  if (event.type === 'red_card') return `${event.description}，${teamName}接下来只能少一人作战。`;
  if (event.type === 'yellow_card') return event.description;
  if (event.type === 'substitution') return `${event.description}，球队尝试改变场上节奏。`;
  return event.description;
}

export function buildLiveCommentaryHistory({
  events,
  currentMinute,
  homeTeamId,
  homeTeamName,
  awayTeamName,
}: CommentaryHistoryContext): LiveCommentaryEntry[] {
  let homeScore = 0;
  let awayScore = 0;
  let penaltyHomeScore = 0;
  let penaltyAwayScore = 0;
  const entries: LiveCommentaryEntry[] = [];
  const commentaryBeats = [0, 3, 30, 46, 60, 85, 91, 106];

  for (const minute of commentaryBeats) {
    if (minute > currentMinute) continue;
    entries.push({
      id: `phase:${minute}`,
      minute,
      label: `${minute}'`,
      text: buildLiveCommentary({
        event: null,
        minute,
        homeScore,
        awayScore,
        penaltyHomeScore,
        penaltyAwayScore,
        homeTeamId,
        homeTeamName,
        awayTeamName,
      }),
    });
  }

  events.forEach((event, index) => {
    if (event.type === 'goal' || event.type === 'own_goal') {
      if (event.teamId === homeTeamId) homeScore++;
      else awayScore++;
    } else if (event.type === 'penalty_goal') {
      if (event.teamId === homeTeamId) penaltyHomeScore++;
      else penaltyAwayScore++;
    }

    entries.push({
      id: `event:${index}:${event.minute}:${event.type}:${event.teamId}:${event.playerId ?? ''}`,
      minute: event.minute,
      label: shootoutEventLabel(event),
      text: buildLiveCommentary({
        event,
        minute: event.minute,
        homeScore,
        awayScore,
        penaltyHomeScore,
        penaltyAwayScore,
        homeTeamId,
        homeTeamName,
        awayTeamName,
      }),
      event,
    });
  });

  return entries.sort((a, b) => b.minute - a.minute || b.id.localeCompare(a.id));
}

export function shootoutEventLabel(event: MatchEvent): string {
  if (event.type !== 'penalty_goal' && event.type !== 'penalty_miss') return `${event.minute}'`;
  if (event.shootout?.suddenDeath) return `骤${Math.max(1, event.shootout.round - 5)}`;
  return `点${event.shootout?.round ?? Math.max(1, Math.ceil((event.minute - 120) / 2))}`;
}
