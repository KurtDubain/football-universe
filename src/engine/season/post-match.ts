import { WindowType, SeasonState } from '../../types/season';
import { TeamBase, TeamState } from '../../types/team';
import { MatchResult } from '../../types/match';
import { StandingEntry } from '../../types/league';
import { CoachState, CareerEntry } from '../../types/coach';
import { SeededRNG } from '../match/rng';
import { applyRestRecovery } from '../state-updater';
import { updateCoachPressure } from '../coaches/coach-pressure';
import { processCoachFiring } from '../coaches/coach-hiring';
import { getTeamCoachId } from '../coaches/coach-lookup';
import { maybeGenerateEvent, applyEventEffect, SeasonEvent } from '../events';
import {
  getAllTeamIds, createNewsId, isUpset,
  countTrailingResult, countTrailingNotResult, isTeamEliminated,
} from './helpers';
import { GameWorld, NewsItem } from './season-manager';

// ── Return type ─────────────────────────────────────────────────

export interface PostMatchResult {
  teamStates: Record<string, TeamState>;
  teamBases: Record<string, TeamBase>;
  coachStates: Record<string, CoachState>;
  coachCareers: Record<string, CareerEntry[]>;
  coachChanges: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[];
  activeEvents: SeasonEvent[];
  news: NewsItem[];
  memorableMatches: import('../../types/memorable').MemorableMatchEntry[];
}

// ── Orchestration function ──────────────────────────────────────

export function runPostMatchProcessing(
  world: GameWorld,
  results: MatchResult[],
  teamsPlayed: Set<string>,
  teamStates: Record<string, TeamState>,
  coachStates: Record<string, CoachState>,
  coachCareers: Record<string, CareerEntry[]>,
  coachChanges: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[],
  windowType: WindowType,
  seasonNumber: number,
  windowIndex: number,
  rng: SeededRNG,
  league1Standings: StandingEntry[],
  league2Standings: StandingEntry[],
  league3Standings: StandingEntry[],
  seasonState: SeasonState,
): PostMatchResult {
  const news: NewsItem[] = [];

  // ── Rest recovery for teams that did not play ────────────────
  for (const teamId of getAllTeamIds(teamStates)) {
    if (!teamsPlayed.has(teamId)) {
      teamStates[teamId] = applyRestRecovery(teamStates[teamId]);
    }
  }

  // ── Coach pressure and firing ────────────────────────────────
  for (const teamId of teamsPlayed) {
    const state = teamStates[teamId];
    const teamBase = world.teamBases[teamId];
    // Read coachStates from LOCAL — we may have just reassigned a coach in a
    // prior loop iteration (cup elimination → fire chain), and need to see
    // that change here.
    const coachId = getTeamCoachId(coachStates, teamId);
    if (!coachId) continue;

    // Find this team's match results (may have multiple in one window)
    const teamResults = results.filter(
      (r) => r.homeTeamId === teamId || r.awayTeamId === teamId,
    );
    if (teamResults.length === 0) continue;

    let currentPressure = state.coachPressure;
    let shouldFire = false;
    let fireResult: ReturnType<typeof updateCoachPressure> | null = null;

    for (const teamResult of teamResults) {
      // Check for cup elimination
      const isCupElimination =
        (windowType === 'league_cup' || windowType === 'super_cup' || windowType === 'world_cup') &&
        isTeamEliminated(teamId, teamResult);

      const pressureUpdate = updateCoachPressure(
        currentPressure,
        teamResult,
        teamId,
        teamBase,
        teamStates[teamId].recentForm,
        isCupElimination,
      );

      currentPressure = pressureUpdate.newPressure;
      if (pressureUpdate.shouldFire) {
        shouldFire = true;
        fireResult = pressureUpdate;
      }
    }

    teamStates[teamId] = {
      ...teamStates[teamId],
      coachPressure: currentPressure,
    };

    if (shouldFire && fireResult) {
      // Process coach firing
      const allCoachData = Object.entries(coachStates).map(([id, cs]) => ({
        base: world.coachBases[id],
        state: cs,
      })).filter((c) => c.base != null);

      const firingResult = processCoachFiring(
        teamId,
        coachId,
        teamBase,
        allCoachData,
        seasonNumber,
        rng,
      );

      // Update fired coach state
      coachStates[coachId] = { ...coachStates[coachId], ...firingResult.firedCoachUpdate };

      // Update or create new coach state
      if (coachStates[firingResult.newCoachId]) {
        coachStates[firingResult.newCoachId] = {
          ...coachStates[firingResult.newCoachId],
          ...firingResult.newCoachUpdate,
        };
      } else {
        // Caretaker coach
        coachStates[firingResult.newCoachId] = {
          id: firingResult.newCoachId,
          currentTeamId: teamId,
          isUnemployed: false,
          unemployedSince: null,
        };
      }

      // Reset pressure for the new coach. The coach assignment itself lives
      // on coachStates[newCoachId].currentTeamId — set above by the spread of
      // firingResult.newCoachUpdate (or the caretaker init).
      teamStates[teamId] = {
        ...teamStates[teamId],
        coachPressure: 10,
      };

      // Update careers
      const firedCoachCareer = [...(coachCareers[coachId] ?? [])];
      const lastEntry = firedCoachCareer[firedCoachCareer.length - 1];
      if (lastEntry && lastEntry.toSeason === null) {
        firedCoachCareer[firedCoachCareer.length - 1] = {
          ...lastEntry,
          ...firingResult.firedCareerUpdate,
        };
      }
      coachCareers[coachId] = firedCoachCareer;

      const newCoachCareerList = [...(coachCareers[firingResult.newCoachId] ?? [])];
      newCoachCareerList.push(firingResult.newCareerEntry);
      coachCareers[firingResult.newCoachId] = newCoachCareerList;

      coachChanges.push({
        teamId,
        oldCoachId: coachId,
        newCoachId: firingResult.newCoachId,
        reason: fireResult.fireReason ?? 'Pressure too high',
      });

      const newCoachName = world.coachBases[firingResult.newCoachId]?.name ?? firingResult.newCoachId;
      const firedCoachName = world.coachBases[coachId]?.name ?? coachId;

      news.push({
        id: createNewsId(seasonNumber, windowIndex, `fire-${teamId}`),
        seasonNumber,
        windowIndex,
        type: 'coach_fired',
        title: `${firedCoachName} 被解雇 — ${teamBase.name}`,
        description: `${firedCoachName} 已被解雇。原因: ${fireResult.fireReason}`,
      });
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `hire-${teamId}`),
        seasonNumber,
        windowIndex,
        type: 'coach_hired',
        title: `${teamBase.name} 聘用新帅 ${newCoachName}`,
        description: `${newCoachName} 正式执教 ${teamBase.name}.`,
      });
    }
  }

  // ── Generate upset news ──────────────────────────────────────
  for (const result of results) {
    const homeTeam = world.teamBases[result.homeTeamId];
    const awayTeam = world.teamBases[result.awayTeamId];
    if (homeTeam && awayTeam && isUpset(homeTeam, awayTeam, result)) {
      const winnerIsHome = result.homeGoals + (result.etHomeGoals ?? 0) > result.awayGoals + (result.etAwayGoals ?? 0);
      const winner = winnerIsHome ? homeTeam : awayTeam;
      const loser = winnerIsHome ? awayTeam : homeTeam;
      const totalH = result.homeGoals + (result.etHomeGoals ?? 0);
      const totalA = result.awayGoals + (result.etAwayGoals ?? 0);
      const score = `${totalH}-${totalA}`;
      const titles = [
        `爆冷！${winner.name} ${score} 击败 ${loser.name}`,
        `冷门！${loser.name}阴沟翻船，不敌${winner.name}`,
        `${winner.name}上演以弱胜强的好戏，${score}掀翻${loser.name}！`,
        `谁能想到？${winner.name}让${loser.name}颜面尽失`,
        `本轮最大冷门：${winner.name}完胜${loser.name}`,
      ];
      const descs = [
        `实力${winner.overall}的${winner.name}令人信服地击败了实力${loser.overall}的${loser.name}，爆冷指数拉满。`,
        `${loser.name}被认为是这场比赛的绝对热门，但${winner.name}用实际行动证明了一切皆有可能。`,
        `${winner.name}毫不畏惧强敌，以${score}的比分书写了属于自己的传奇篇章。`,
      ];
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `upset-${result.fixtureId}`),
        seasonNumber, windowIndex, type: 'upset',
        title: rng.pick(titles),
        description: rng.pick(descs),
      });
    }
  }

  // ── Streak news ──────────────────────────────────────
  for (const teamId of teamsPlayed) {
    const state = teamStates[teamId];
    const form = state.recentForm;
    if (form.length < 3) continue;
    const teamName = world.teamBases[teamId]?.name ?? teamId;

    const winStreak = countTrailingResult(form, 'W');
    if (winStreak >= 3) {
      const titles = [
        `势不可挡！${teamName}已取得${winStreak}连胜`,
        `${teamName}${winStreak}连胜，状态火热谁能阻挡？`,
        `连战连捷！${teamName}气势如虹拿下${winStreak}连胜`,
        `${teamName}近期表现强势，${winStreak}场比赛全部获胜`,
      ];
      const descs = [
        `${teamName}近期状态爆棚，${winStreak}连胜让所有对手都感到恐惧。`,
        `势如破竹的${teamName}已经连续${winStreak}场取得胜利，争冠路上不容小觑。`,
        `${teamName}在最近${winStreak}场比赛中表现得无懈可击。`,
      ];
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-w-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: rng.pick(titles), description: rng.pick(descs),
      });
    }

    const lossStreak = countTrailingResult(form, 'L');
    if (lossStreak >= 3) {
      const titles = [
        `${teamName}深陷泥潭，遭遇${lossStreak}连败`,
        `至暗时刻！${teamName}已连输${lossStreak}场`,
        `${teamName}${lossStreak}连败，主帅压力骤增`,
        `何时是头？${teamName}连续${lossStreak}场颗粒无收`,
      ];
      const descs = [
        `${teamName}正在经历赛季最黑暗的时期，${lossStreak}连败让球队士气跌入谷底。`,
        `连续${lossStreak}场失利让${teamName}的赛季前景蒙上阴影，教练席上风声鹤唳。`,
      ];
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-l-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: rng.pick(titles), description: rng.pick(descs),
      });
    }

    const unbeaten = countTrailingNotResult(form, 'L');
    if (unbeaten >= 5) {
      const titles = [
        `${teamName}${unbeaten}场不败，铁血意志！`,
        `坚如磐石！${teamName}已经${unbeaten}场不败`,
        `${teamName}保持${unbeaten}场不败金身，谁能终结？`,
      ];
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `streak-u-${teamId}`),
        seasonNumber, windowIndex, type: 'streak',
        title: rng.pick(titles),
        description: `${teamName}在最近${unbeaten}场比赛中保持不败，展现了强大的竞争力。`,
      });
    }
  }

  // ── Special match event news ────────────────────────────────
  for (const result of results) {
    const goalEvents = result.events.filter(e => e.type === 'goal' || e.type === 'penalty_goal');

    // Hat trick detection (3+ goals by same player number)
    const playerGoals = new Map<string, number>();
    for (const e of goalEvents) {
      if (e.playerId) {
        playerGoals.set(e.playerId, (playerGoals.get(e.playerId) ?? 0) + 1);
      }
    }
    for (const [playerId, count] of playerGoals) {
      if (count >= 3) {
        const parts = playerId.split('-');
        const num = parts[parts.length - 1];
        const teamId = parts.slice(0, -1).join('-');
        const teamName = world.teamBases[teamId]?.name ?? teamId;
        const playerName = world.squads[teamId]?.find(p => p.id === playerId)?.name ?? `${num}号`;
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `hattrick-${playerId}`),
          seasonNumber, windowIndex, type: 'match_result',
          title: `帽子戏法! ${teamName} ${playerName}独进${count}球`,
          description: `${teamName}的${playerName}上演帽子戏法，独中${count}元。`,
        });
      }
    }

    // Late drama (goal at 85+ min that changed the result)
    const lateGoals = goalEvents.filter(e => e.minute >= 85 && e.minute <= 90);
    if (lateGoals.length > 0) {
      const totalHome = result.homeGoals;
      const totalAway = result.awayGoals;
      const diff = Math.abs(totalHome - totalAway);
      if (diff <= 1) {
        const scorer = lateGoals[lateGoals.length - 1];
        const teamName = world.teamBases[scorer.teamId]?.name ?? scorer.teamId;
        const scorerLabel = scorer.playerName ?? (scorer.playerNumber ? `${scorer.playerNumber}号` : '');
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `latedrama-${result.fixtureId}`),
          seasonNumber, windowIndex, type: 'match_result',
          title: `绝杀! ${teamName} ${scorerLabel}补时建功`,
          description: `${teamName}在第${scorer.minute}分钟打入关键进球，上演绝杀好戏！`,
        });
      }
    }
  }

  // ── Random season events ─────────────────────────────────────
  let activeEvents = [...(world.activeEvents ?? [])];
  let teamBasesUpdated = { ...world.teamBases };

  // Expire old events
  const expired = activeEvents.filter(e => e.duration > 0 && windowIndex - e.windowApplied >= e.duration);
  for (const e of expired) {
    teamBasesUpdated = applyEventEffect(teamBasesUpdated, e, true); // reverse
  }
  activeEvents = activeEvents.filter(e => !expired.includes(e));

  // ── Midseason milestone check (~50% progress) ───────────────
  const totalWindows = seasonState.calendar.length;
  const midPoint = Math.floor(totalWindows / 2);
  if (windowIndex === midPoint && windowType === 'league') {
    const leader1 = league1Standings[0];
    const leader2 = league2Standings[0];
    const bottom1 = league1Standings[league1Standings.length - 1];
    if (leader1) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, 'milestone-mid'),
        seasonNumber, windowIndex, type: 'streak',
        title: '赛季半程：联赛格局初定',
        description: `顶级联赛半程领头羊: ${world.teamBases[leader1.teamId]?.name}(${leader1.points}分)。${bottom1 ? `保级区: ${world.teamBases[bottom1.teamId]?.name}(${bottom1.points}分)` : ''}`,
      });
    }
  }

  // Maybe generate new event
  const newEvent = maybeGenerateEvent(rng, teamBasesUpdated, seasonNumber, windowIndex, activeEvents);
  if (newEvent) {
    activeEvents.push(newEvent);
    if (newEvent.effect.field === 'morale') {
      // Apply morale directly to teamState
      const ts = teamStates[newEvent.teamId];
      if (ts) {
        teamStates[newEvent.teamId] = { ...ts, morale: Math.max(10, Math.min(100, ts.morale + newEvent.effect.delta)) };
      }
    } else {
      teamBasesUpdated = applyEventEffect(teamBasesUpdated, newEvent);
    }
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `event-${newEvent.type}`),
      seasonNumber, windowIndex, type: 'match_result',
      title: newEvent.title,
      description: newEvent.description,
    });
  }

  // ── Memorable match detection ─────────────────────────────────
  const memorableMatches: import('../../types/memorable').MemorableMatchEntry[] = [];
  for (const result of results) {
    const totalH = result.homeGoals + (result.etHomeGoals ?? 0);
    const totalA = result.awayGoals + (result.etAwayGoals ?? 0);
    const totalGoals = totalH + totalA;
    const diff = Math.abs(totalH - totalA);
    const isFinal = result.roundLabel === 'Final' || result.roundLabel.includes('决赛');

    let memType: import('../../types/memorable').MemorableType | null = null;
    let label = '';

    if (result.penalties && isFinal) {
      memType = 'shootout';
      label = '决赛点球大战';
    } else if (diff >= 4) {
      memType = 'blowout';
      label = `${totalH}:${totalA} 大屠杀`;
    } else if (totalGoals >= 6) {
      memType = 'goalfest';
      label = `进球大战 ${totalH}:${totalA}`;
    } else {
      // Last-minute decider
      const lateGoals = result.events.filter((e) =>
        (e.type === 'goal' || e.type === 'penalty_goal') && e.minute >= 88,
      );
      if (lateGoals.length > 0 && diff === 1 && !isFinal) {
        memType = 'last_minute';
        label = `${lateGoals[lateGoals.length - 1].minute}'绝杀`;
      }
      // Upset (only check league + cup KO matches)
      if (!memType) {
        const homeBase = world.teamBases[result.homeTeamId];
        const awayBase = world.teamBases[result.awayTeamId];
        if (homeBase && awayBase) {
          const ovrDiff = Math.abs(homeBase.overall - awayBase.overall);
          if (ovrDiff >= 15) {
            const homeWon = totalH > totalA;
            const awayWon = totalA > totalH;
            const weakerTeamWon =
              (homeWon && homeBase.overall < awayBase.overall) ||
              (awayWon && awayBase.overall < homeBase.overall);
            if (weakerTeamWon) {
              memType = 'upset';
              label = '世纪冷门';
            }
          }
        }
      }
    }

    if (memType) {
      memorableMatches.push({
        season: seasonNumber,
        windowIndex,
        type: memType,
        label,
        result,
      });
    }
  }

  return {
    teamStates,
    teamBases: teamBasesUpdated,
    coachStates,
    coachCareers,
    coachChanges,
    activeEvents,
    news,
    memorableMatches,
  };
}
