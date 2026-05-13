import { GameWorld } from './season-manager';
import { getTeamCoachId } from '../coaches/coach-lookup';

export interface StorylineCard {
  teamId: string;
  type: 'streak' | 'title_race' | 'coach_pressure' | 'cup_run' | 'relegation_fight';
  emoji: string;
  title: string;
  body: string;
  /** higher = more prominent */
  priority: number;
}

/**
 * Generate narrative storyline cards for the user's favorite teams.
 *
 * Each card describes a noteworthy ongoing situation. Up to ~3 cards total
 * are returned, prioritized.
 */
export function generateStorylineCards(
  world: GameWorld,
  favoriteTeamIds: string[],
): StorylineCard[] {
  const cards: StorylineCard[] = [];

  for (const teamId of favoriteTeamIds) {
    const team = world.teamBases[teamId];
    const state = world.teamStates[teamId];
    if (!team || !state) continue;

    // ── Win streak ─────────────────────────────────────────────
    const recent = state.recentForm;
    let streak = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === 'W') streak++;
      else break;
    }
    if (streak >= 3) {
      cards.push({
        teamId,
        type: 'streak',
        emoji: '🔥',
        title: `${team.name} 已取得 ${streak} 连胜`,
        body: streak >= 6
          ? '气势如虹的状态让人不禁联想到当年的王朝之师。'
          : streak >= 4
            ? '球队火热的状态正在转化为联赛位置。'
            : '一波短促的连胜，足以扭转赛季走向。',
        priority: streak * 2,
      });
    }

    // ── Losing streak ──────────────────────────────────────────
    let lossStreak = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] === 'L') lossStreak++;
      else break;
    }
    if (lossStreak >= 3) {
      cards.push({
        teamId,
        type: 'streak',
        emoji: '📉',
        title: `${team.name} 遭遇 ${lossStreak} 连败`,
        body: '球迷已经开始对管理层的耐心表示质疑。',
        priority: lossStreak * 2 - 1,
      });
    }

    // ── Title race ─────────────────────────────────────────────
    const standings = state.leagueLevel === 1
      ? world.league1Standings
      : state.leagueLevel === 2
        ? world.league2Standings
        : world.league3Standings;
    const myEntry = standings.find((s) => s.teamId === teamId);
    if (myEntry && myEntry.played > 0) {
      const myRank = standings.indexOf(myEntry) + 1;
      const leader = standings[0];
      const ptsDiff = leader.points - myEntry.points;
      // Only fire if season progress > 30% and team is competitive
      const totalGames = (standings.length - 1) * 2;
      const progress = myEntry.played / totalGames;
      if (progress > 0.3 && myRank <= 5 && ptsDiff <= 8) {
        let title = '';
        let body = '';
        if (myRank === 1) {
          title = `${team.name} 高居榜首，领先第二名 ${standings[1] ? standings[0].points - standings[1].points : 0} 分`;
          body = '王朝的种子正在悄悄发芽，球迷们已经开始幻想冠军游行。';
        } else if (myRank === 2 && ptsDiff <= 3) {
          title = `${team.name} 紧追榜首，距离 ${leader.teamId === teamId ? '' : world.teamBases[leader.teamId]?.name ?? ''} 仅 ${ptsDiff} 分`;
          body = '一个回合的胜负，可能就是冠军和亚军的分野。';
        } else if (myRank <= 4) {
          title = `${team.name} 位列第 ${myRank}，距榜首 ${ptsDiff} 分`;
          body = '只要不出意外，亚冠区已经唾手可得。';
        }
        if (title) {
          cards.push({
            teamId,
            type: 'title_race',
            emoji: '🏆',
            title,
            body,
            priority: 8 - myRank,
          });
        }
      }

      // ── Relegation fight ────────────────────────────────────
      const fromBottom = standings.length - myRank + 1;
      if (progress > 0.5 && state.leagueLevel <= 2 && fromBottom <= 3) {
        cards.push({
          teamId,
          type: 'relegation_fight',
          emoji: '⚠️',
          title: `${team.name} 深陷降级区，倒数第 ${fromBottom}`,
          body: '保级战已经迫在眉睫，每一分都至关重要。',
          priority: 10 - fromBottom,
        });
      }
    }

    // ── Coach pressure ─────────────────────────────────────────
    if (state.coachPressure >= 70) {
      const stateCoachId = getTeamCoachId(world.coachStates, teamId);
      const coachName = stateCoachId
        ? world.coachBases[stateCoachId]?.name ?? '主帅'
        : '主帅';
      cards.push({
        teamId,
        type: 'coach_pressure',
        emoji: '🔥',
        title: `${team.name} 主帅 ${coachName} 压力山大`,
        body: `压力指数高达 ${state.coachPressure}，下课传闻已经传遍更衣室。`,
        priority: 6,
      });
    }

    // ── Cup deep run ───────────────────────────────────────────
    // League cup — only if cup not yet decided AND team is in latest round
    const lc = world.leagueCup;
    if (lc && !lc.completed && lc.rounds.length >= 3) {
      const recentRound = lc.rounds[lc.rounds.length - 1];
      if (recentRound.fixtures.some((f) => f.homeTeamId === teamId || f.awayTeamId === teamId)) {
        const roundName = ['', '32强', '16强', '八强', '四强', '决赛'][lc.rounds.length] ?? `第${lc.rounds.length}轮`;
        cards.push({
          teamId,
          type: 'cup_run',
          emoji: '🥇',
          title: `${team.name} 杀入联赛杯 ${roundName}`,
          body: '杯赛奇迹仍在继续，距离捧杯只差几步。',
          priority: lc.rounds.length + 2,
        });
      }
    }
  }

  // Sort by priority desc, take top 3
  cards.sort((a, b) => b.priority - a.priority);
  return cards.slice(0, 3);
}
