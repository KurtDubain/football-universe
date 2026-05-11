import { SeasonState } from '../../types/season';
import { TeamBase, TeamState, Trophy, SeasonRecord } from '../../types/team';
import { CoachBase, CoachState, CareerEntry } from '../../types/coach';
import { StandingEntry } from '../../types/league';
import { CupState, SuperCupState, WorldCupState, CupFixture } from '../../types/cup';
import { MatchResult } from '../../types/match';
import { HonorRecord } from '../../types/honor';
import { Player, PlayerSeasonStats } from '../../types/player';
import { SeededRNG } from '../match/rng';
import { applySeasonEndReset } from '../state-updater';
import { createHonorRecord, generateTeamTrophies } from '../honors/honors';
import { maybeGenerateEvent, applyEventEffect, SeasonEvent } from '../events';
import { checkAchievements, Achievement } from '../achievements';
import { selectWorldCupParticipants, initWorldCup } from '../cups/world-cup';
import { getSuperCupGroupFixtures } from '../cups/super-cup';
import { getAllTeamIds, getTeamIdsByLeague, createNewsId, cnRoundLabel } from './helpers';
import { GameWorld, NewsItem } from './season-manager';
import { appendWorldCupWindows } from './calendar-builder';
import { BALANCE } from '../../config/balance';
import { updateCoachPressure } from '../coaches/coach-pressure';
import { processCoachFiring } from '../coaches/coach-hiring';

/**
 * Handle end-of-season processing: honors, trophies, records, and prep next season.
 */
export function handleSeasonEnd(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // Determine champions
  const league1Champion = world.league1Standings[0]?.teamId ?? '';
  const league2Champion = world.league2Standings[0]?.teamId ?? '';
  const league3Champion = world.league3Standings[0]?.teamId ?? '';
  const leagueCupWinner = world.leagueCup.winnerId ?? '';
  const superCupWinner = world.superCup.winnerId ?? '';
  const worldCupWinner = world.worldCup?.winnerId;

  // Promotion / relegation — derive ACTUAL movements from teamStates
  const proRelStandings: Record<number, StandingEntry[]> = {
    1: world.league1Standings, 2: world.league2Standings, 3: world.league3Standings,
  };
  const actualPromoted: { teamId: string; from: number; to: number }[] = [];
  const actualRelegated: { teamId: string; from: number; to: number }[] = [];
  for (const teamId of getAllTeamIds(world.teamStates)) {
    const currentLevel = world.teamStates[teamId].leagueLevel;
    let playedLevel = currentLevel;
    for (const [lvStr, st] of Object.entries(proRelStandings)) {
      if (st.some(s => s.teamId === teamId && s.played > 0)) {
        playedLevel = parseInt(lvStr) as 1 | 2 | 3;
        break;
      }
    }
    if (currentLevel < playedLevel) actualPromoted.push({ teamId, from: playedLevel, to: currentLevel });
    else if (currentLevel > playedLevel) actualRelegated.push({ teamId, from: playedLevel, to: currentLevel });
  }

  // Create honor record
  const honor = createHonorRecord(
    seasonNumber,
    league1Champion,
    league2Champion,
    league3Champion,
    leagueCupWinner,
    superCupWinner,
    worldCupWinner,
    actualPromoted,
    actualRelegated,
    world.coachChangesThisSeason,
  );
  const honorHistory = [...world.honorHistory, honor];

  // Generate trophies for all teams
  const teamTrophies = { ...world.teamTrophies };
  const coachTrophies = { ...world.coachTrophies };
  for (const teamId of getAllTeamIds(world.teamStates)) {
    const teamState = world.teamStates[teamId];
    const trophies = generateTeamTrophies(
      teamId,
      seasonNumber,
      league1Champion,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      superCupWinner,
      worldCupWinner,
      teamState.leagueLevel,
    );
    teamTrophies[teamId] = [...(teamTrophies[teamId] ?? []), ...trophies];

    // Also attribute trophies to the coach
    const coachId = teamState.currentCoachId;
    if (coachId && trophies.length > 0) {
      coachTrophies[coachId] = [...(coachTrophies[coachId] ?? []), ...trophies];

      // Update coach career entry with trophies
      const careerList = [...(world.coachCareers[coachId] ?? [])];
      const lastEntry = careerList[careerList.length - 1];
      if (lastEntry && lastEntry.toSeason === null) {
        careerList[careerList.length - 1] = {
          ...lastEntry,
          trophies: [...lastEntry.trophies, ...trophies],
        };
      }
      world.coachCareers[coachId] = careerList;
    }
  }

  // Generate trophy news + season summary news
  const news: NewsItem[] = [];
  const windowIndex = world.seasonState.currentWindowIndex;

  if (league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l1'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league1Champion]?.name} 夺得顶级联赛冠军!`,
      description: `${world.teamBases[league1Champion]?.name} 加冕顶级联赛冠军，以${world.league1Standings[0]?.points}分的成绩登顶。`,
    });
  }
  if (league2Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-l2'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[league2Champion]?.name} 夺得甲级联赛冠军!`,
      description: `${world.teamBases[league2Champion]?.name} 以${world.league2Standings[0]?.points}分荣膺甲级联赛冠军。`,
    });
  }
  if (leagueCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-lc'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[leagueCupWinner]?.name} 夺得联赛杯冠军!`,
      description: `${world.teamBases[leagueCupWinner]?.name} 捧得联赛杯冠军奖杯。`,
    });
  }
  if (superCupWinner) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'trophy-sc'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `${world.teamBases[superCupWinner]?.name} 夺得超级杯冠军!`,
      description: `${world.teamBases[superCupWinner]?.name} 赢得超级杯冠军荣耀。`,
    });
  }

  // ── Multi-crown detection ──
  const allWinners = [league1Champion, leagueCupWinner, superCupWinner, worldCupWinner].filter(Boolean);
  const crownCounts = new Map<string, number>();
  for (const w of allWinners) { if (w) crownCounts.set(w, (crownCounts.get(w) ?? 0) + 1); }
  for (const [teamId, count] of crownCounts) {
    if (count >= 4) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `四冠王！${world.teamBases[teamId]?.name} 包揽所有冠军！`,
        description: `${world.teamBases[teamId]?.name}创造历史，在一个赛季内夺得全部冠军头衔！`,
      });
    } else if (count >= 3) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `三冠王！${world.teamBases[teamId]?.name} 创造伟业！`,
        description: `${world.teamBases[teamId]?.name}一个赛季夺得三座冠军奖杯，成就三冠王荣耀！`,
      });
    } else if (count >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `crown-${teamId}`),
        seasonNumber, windowIndex, type: 'trophy',
        title: `双冠王！${world.teamBases[teamId]?.name}`,
        description: `${world.teamBases[teamId]?.name}本赛季荣获两座冠军奖杯，成就双冠王！`,
      });
    }
  }

  // ── Underdog achievements ──
  // Cup finalist from lower leagues
  const cupFinalists = [leagueCupWinner, superCupWinner].filter(Boolean);
  for (const fId of cupFinalists) {
    if (!fId) continue;
    const teamState = world.teamStates[fId];
    if (teamState && teamState.leagueLevel >= 2) {
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `underdog-${fId}`),
        seasonNumber, windowIndex, type: 'upset',
        title: `黑马奇迹！${world.teamBases[fId]?.name} 以下克上夺冠！`,
        description: `来自${teamState.leagueLevel === 2 ? '甲级' : '乙级'}联赛的${world.teamBases[fId]?.name}在杯赛中上演了不可思议的夺冠之旅！`,
      });
    }
  }

  // ── Season summary news ──

  // Top scorer
  const allPlayerStats = Object.values(world.playerStats);
  const topScorer = allPlayerStats.reduce((best, s) => s.goals > (best?.goals ?? 0) ? s : best, null as { goals: number; playerId: string; teamId: string } | null);
  if (topScorer && topScorer.goals > 0) {
    const parts = topScorer.playerId.split('-');
    const num = parts[parts.length - 1];
    const teamName = world.teamBases[topScorer.teamId]?.name ?? topScorer.teamId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'scorer'),
      seasonNumber, windowIndex, type: 'trophy',
      title: `赛季射手王: ${teamName} ${num}号 (${topScorer.goals}球)`,
      description: `${teamName}的${num}号球员以${topScorer.goals}粒进球荣获本赛季射手王。`,
    });
  }

  // Best defense (least goals conceded in top league)
  const bestDefense = [...world.league1Standings].sort((a, b) => a.goalsAgainst - b.goalsAgainst)[0];
  if (bestDefense && bestDefense.played > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'defense'),
      seasonNumber, windowIndex, type: 'streak',
      title: `最佳防守: ${world.teamBases[bestDefense.teamId]?.name} (仅失${bestDefense.goalsAgainst}球)`,
      description: `${world.teamBases[bestDefense.teamId]?.name}以全赛季仅丢${bestDefense.goalsAgainst}球成为顶级联赛最佳防线。`,
    });
  }

  // Most goals scored in top league
  const bestAttack = [...world.league1Standings].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  if (bestAttack && bestAttack.played > 0 && bestAttack.teamId !== league1Champion) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'attack'),
      seasonNumber, windowIndex, type: 'streak',
      title: `火力最猛: ${world.teamBases[bestAttack.teamId]?.name} (${bestAttack.goalsFor}球)`,
      description: `${world.teamBases[bestAttack.teamId]?.name}以${bestAttack.goalsFor}粒进球成为顶级联赛最强火力。`,
    });
  }

  // Promoted teams
  for (const p of actualPromoted) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `promo-${p.teamId}`),
      seasonNumber, windowIndex, type: 'promotion',
      title: `${world.teamBases[p.teamId]?.name} 升级成功!`,
      description: `${world.teamBases[p.teamId]?.name} 从${p.from}级联赛升入${p.to}级联赛。`,
    });
  }

  // Relegated teams
  for (const r of actualRelegated) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `releg-${r.teamId}`),
      seasonNumber, windowIndex, type: 'relegation',
      title: `${world.teamBases[r.teamId]?.name} 不幸降级`,
      description: `${world.teamBases[r.teamId]?.name} 从${r.from}级联赛降入${r.to}级联赛。`,
    });
  }

  // Coach changes summary
  if (world.coachChangesThisSeason.length > 0) {
    news.push({
      id: createNewsId(seasonNumber, windowIndex, 'coach-summary'),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `本赛季共有 ${world.coachChangesThisSeason.length} 次换帅`,
      description: world.coachChangesThisSeason.map(c => `${world.teamBases[c.teamId]?.name}`).join('、') + ' 更换了教练。',
    });
  }

  // Create season records for all teams
  const teamSeasonRecords = { ...world.teamSeasonRecords };
  const allStandings: Record<number, StandingEntry[]> = {
    1: world.league1Standings,
    2: world.league2Standings,
    3: world.league3Standings,
  };

  for (const teamId of getAllTeamIds(world.teamStates)) {
    const teamState = world.teamStates[teamId];
    // Find this team's standings entry — search ALL leagues since leagueLevel
    // may have changed due to promotion/relegation
    let entry: StandingEntry | undefined;
    let foundLevel: 1 | 2 | 3 = teamState.leagueLevel;
    for (const [lvStr, st] of Object.entries(allStandings)) {
      const found = st.find((s) => s.teamId === teamId);
      if (found && found.played > 0) {
        entry = found;
        foundLevel = parseInt(lvStr) as 1 | 2 | 3;
        break;
      }
    }
    const standings = allStandings[foundLevel] ?? [];
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    // Determine cup results for this team
    let cupResult: string | undefined;
    let superCupResult: string | undefined;
    let worldCupResult: string | undefined;

    // League cup
    if (teamId === leagueCupWinner) cupResult = '冠军';
    else {
      // Check if runner-up (in final but lost)
      const lcFinal = world.leagueCup.rounds.at(-1);
      if (lcFinal?.fixtures[0] && (lcFinal.fixtures[0].homeTeamId === teamId || lcFinal.fixtures[0].awayTeamId === teamId)) {
        cupResult = '亚军';
      } else {
        // Find which round they were eliminated
        for (const round of world.leagueCup.rounds) {
          const inRound = round.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId);
          if (inRound && round.completed) {
            const won = round.fixtures.some(f => f.winnerId === teamId);
            if (!won) { cupResult = cnRoundLabel(round.roundName); break; }
          }
        }
      }
    }

    // Super cup
    if (teamId === superCupWinner) superCupResult = '冠军';
    else {
      const scFinal = world.superCup.knockoutRounds.at(-1);
      if (scFinal?.fixtures[0] && (scFinal.fixtures[0].homeTeamId === teamId || scFinal.fixtures[0].awayTeamId === teamId)) {
        superCupResult = '亚军';
      } else if (world.superCup.groups.some(g => g.teamIds.includes(teamId))) {
        if (world.superCup.groupStageCompleted) {
          const inKnockout = world.superCup.knockoutRounds.some(r => r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId));
          superCupResult = inKnockout ? '淘汰赛' : '小组赛出局';
        } else {
          superCupResult = '参赛中';
        }
      }
    }

    // World cup
    if (world.worldCup) {
      if (teamId === worldCupWinner) worldCupResult = '冠军';
      else if (world.worldCup.knockoutRounds.at(-1)?.fixtures[0] &&
        (world.worldCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === teamId ||
         world.worldCup.knockoutRounds.at(-1)!.fixtures[0].awayTeamId === teamId)) {
        worldCupResult = '亚军';
      } else if (world.worldCup.participantIds.includes(teamId)) {
        const inKnockout = world.worldCup.knockoutRounds.some(r => r.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId));
        if (world.worldCup.completed) {
          worldCupResult = inKnockout ? '淘汰赛' : '小组赛出局';
        } else {
          worldCupResult = '参赛中';
        }
      }
    }

    const record: SeasonRecord = {
      seasonNumber,
      leagueLevel: foundLevel,
      leaguePosition: position,
      leaguePlayed: entry?.played ?? 0,
      leagueWon: entry?.won ?? 0,
      leagueDrawn: entry?.drawn ?? 0,
      leagueLost: entry?.lost ?? 0,
      leagueGF: entry?.goalsFor ?? 0,
      leagueGA: entry?.goalsAgainst ?? 0,
      leaguePoints: entry?.points ?? 0,
      cupResult,
      superCupResult,
      worldCupResult,
      coachId: teamState.currentCoachId ?? '',
      teamOverall: world.teamBases[teamId]?.overall ?? 0,
      promoted: teamState.leagueLevel < foundLevel,
      relegated: teamState.leagueLevel > foundLevel,
    };

    teamSeasonRecords[teamId] = [...(teamSeasonRecords[teamId] ?? []), record];
  }

  // ── Coach voluntary departure (急流勇退) ─────────────────────
  // Top coaches who just won a major trophy have a small chance of leaving
  for (const teamId of getAllTeamIds(world.teamStates)) {
    const coachId = world.teamStates[teamId]?.currentCoachId;
    if (!coachId) continue;
    const coach = world.coachBases[coachId];
    if (!coach || coach.rating < 78) continue; // only elite coaches do this

    // Check if this coach's team won a major trophy this season
    const wonMajor = teamId === league1Champion || teamId === leagueCupWinner || teamId === superCupWinner;
    if (!wonMajor) continue;

    // 8% chance per major trophy won
    if (rng.next() >= 0.08) continue;

    // Coach voluntarily leaves
    const allCoachData = Object.entries(world.coachStates).map(([id, cs]) => ({
      base: world.coachBases[id], state: cs,
    })).filter(c => c.base != null);

    const firingResult = processCoachFiring(teamId, coachId, world.teamBases[teamId], allCoachData, seasonNumber, rng);

    world.coachStates[coachId] = { ...world.coachStates[coachId], ...firingResult.firedCoachUpdate };
    world.coachStates[firingResult.newCoachId] = { ...world.coachStates[firingResult.newCoachId], ...firingResult.newCoachUpdate };
    world.teamStates[teamId] = { ...world.teamStates[teamId], currentCoachId: firingResult.newCoachId, coachPressure: 5 };

    const careerList = [...(world.coachCareers[coachId] ?? [])];
    if (careerList.length > 0) {
      careerList[careerList.length - 1] = { ...careerList[careerList.length - 1], toSeason: seasonNumber, fired: false };
    }
    world.coachCareers[coachId] = careerList;
    world.coachCareers[firingResult.newCoachId] = [...(world.coachCareers[firingResult.newCoachId] ?? []), firingResult.newCareerEntry];

    const coachName = coach.name;
    const newCoachName = world.coachBases[firingResult.newCoachId]?.name ?? firingResult.newCoachId;
    news.push({
      id: createNewsId(seasonNumber, windowIndex, `retire-${coachId}`),
      seasonNumber, windowIndex, type: 'coach_fired',
      title: `${coachName} 功成身退，告别${world.teamBases[teamId]?.name}`,
      description: `${coachName}在率队夺冠后选择急流勇退，留下一段传奇执教生涯。${newCoachName}将接过教鞭。`,
    });

    world.coachChangesThisSeason.push({
      teamId, oldCoachId: coachId, newCoachId: firingResult.newCoachId,
      reason: '功成身退',
    });
  }

  // ── Check achievements ──────────────────────────────────────
  let achievements = [...(world.achievements ?? [])];
  for (const teamId of getAllTeamIds(world.teamStates)) {
    const records = teamSeasonRecords[teamId] ?? [];
    const currentRecord = records[records.length - 1];
    if (!currentRecord) continue;
    const newAch = checkAchievements(teamId, world.teamBases[teamId]?.name ?? teamId, seasonNumber, currentRecord, records, achievements);
    if (newAch.length > 0) {
      achievements = [...achievements, ...newAch];
      for (const a of newAch) {
        news.push({
          id: createNewsId(seasonNumber, windowIndex, `ach-${a.id}`),
          seasonNumber, windowIndex, type: 'trophy',
          title: `成就解锁: ${a.title}`,
          description: a.description,
        });
      }
    }
  }

  // Apply season-end reset to team states
  let teamStates = { ...world.teamStates };
  for (const teamId of getAllTeamIds(teamStates)) {
    const state = teamStates[teamId];
    const standings = allStandings[state.leagueLevel] ?? [];
    const entry = standings.find((s) => s.teamId === teamId);
    const position = entry ? standings.indexOf(entry) + 1 : standings.length;

    teamStates[teamId] = applySeasonEndReset(state, position, standings.length);
  }

  // ── Team growth/decline based on season performance ─────────
  const teamBases = { ...world.teamBases };
  for (const teamId of getAllTeamIds(teamStates)) {
    const base = { ...teamBases[teamId] };
    const state = teamStates[teamId];
    const originalOvr = base.overall;

    let growthEntry: StandingEntry | undefined;
    let growthLevel: number = state.leagueLevel;
    for (const [lvStr, st] of Object.entries(allStandings)) {
      const found = st.find((s) => s.teamId === teamId);
      if (found && found.played > 0) { growthEntry = found; growthLevel = parseInt(lvStr); break; }
    }
    const standings = allStandings[growthLevel] ?? [];
    const position = growthEntry ? standings.indexOf(growthEntry) + 1 : standings.length;
    const total = standings.length;
    const ratio = total > 0 ? position / total : 1;

    // ── Performance-based growth ──
    if (ratio <= 0.15) {
      base.overall = Math.min(97, base.overall + rng.nextInt(1, 2));
    } else if (ratio <= 0.35) {
      base.overall = Math.min(97, base.overall + rng.nextInt(0, 1));
    } else if (ratio >= 0.85) {
      const declineMax = base.overall > 60 ? 2 : 1;
      base.overall = Math.max(38, base.overall - rng.nextInt(1, declineMax));
    } else if (ratio >= 0.7) {
      if (base.overall > 50) {
        base.overall = Math.max(38, base.overall - rng.nextInt(0, 1));
      }
    }

    // ── Natural aging: only the very top, and probabilistic ──
    if (base.overall >= 93 && rng.next() < 0.5) {
      base.overall = base.overall - 1;
    }

    // ── Floor uplift: weakest teams always improve a little ──
    if (base.overall <= 45) {
      base.overall = base.overall + 1;
    }

    // ── Mean reversion: gentle pull, skip teams that just won ──
    const leagueMean = 65;
    const distFromMean = base.overall - leagueMean;
    if (Math.abs(distFromMean) > 20 && ratio > 0.15) {
      const pullChance = Math.min(0.4, Math.abs(distFromMean) / 120);
      if (rng.next() < pullChance) {
        base.overall += distFromMean > 0 ? -1 : 1;
      }
    }

    // Clamp overall — top 3 teams have a higher floor (dynasty DNA)
    const PROTECTED_TEAMS = ['gz_hengda', 'shimazu', 'xibei_wolf'];
    const floor = PROTECTED_TEAMS.includes(teamId) ? 82 : 38;
    base.overall = Math.max(floor, Math.min(97, base.overall));

    // ── Proportional attribute sync ──
    const ovrDelta = base.overall - originalOvr;
    if (ovrDelta !== 0) {
      const sign = ovrDelta > 0 ? 1 : -1;
      const mag = Math.abs(ovrDelta);
      base.attack = Math.max(35, Math.min(96, base.attack + sign * rng.nextInt(0, mag)));
      base.midfield = Math.max(35, Math.min(96, base.midfield + sign * rng.nextInt(0, Math.max(1, mag - 1))));
      base.defense = Math.max(35, Math.min(96, base.defense + sign * rng.nextInt(0, Math.max(1, mag - 1))));
      base.stability = Math.max(35, Math.min(96, base.stability + sign * rng.nextInt(0, 1)));
      base.depth = Math.max(30, Math.min(96, base.depth + sign * rng.nextInt(0, mag)));
    }

    // ── Promoted teams get a boost ──
    const startLevel = (world.seasonStartLevels ?? {})[teamId] ?? base.initialLeagueLevel;
    if (state.leagueLevel < startLevel) {
      const promoBoost = rng.nextInt(3, 5);
      base.overall = Math.min(97, base.overall + promoBoost);
      base.depth = Math.min(97, base.depth + rng.nextInt(2, 4));
      base.attack = Math.min(97, base.attack + rng.nextInt(1, 3));
      base.midfield = Math.min(97, base.midfield + rng.nextInt(1, 2));
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `boost-${teamId}`),
        seasonNumber, windowIndex, type: 'match_result',
        title: `${base.name} 升级后大力引援`,
        description: `${base.name}升级后获得大量投资，整体实力提升${promoBoost}点。`,
      });
    }
    // Relegated teams decline
    if (state.leagueLevel > startLevel) {
      base.overall = Math.max(38, base.overall - rng.nextInt(1, 2));
      base.depth = Math.max(30, base.depth - rng.nextInt(1, 2));
    }

    // Strong teams have a chance of "internal turmoil"
    if (base.overall >= 87 && rng.next() < 0.10) {
      const drop = rng.nextInt(2, 4);
      base.overall = Math.max(70, base.overall - drop);
      base.attack = Math.max(60, base.attack - rng.nextInt(1, 2));
      base.stability = Math.max(50, base.stability - rng.nextInt(1, 3));
      news.push({
        id: createNewsId(seasonNumber, windowIndex, `turmoil-${teamId}`),
        seasonNumber, windowIndex, type: 'coach_fired',
        title: `${base.name} 遭遇内部动荡`,
        description: `${base.name}核心球员出走，更衣室出现裂痕，实力下降${drop}点。`,
      });
    }

    // Underperformance bonus
    const expectedPos = Math.round(total * (1 - (base.expectation - 1) / 4));
    if (position < expectedPos - 3 && ratio <= 0.4) {
      const surpriseBoost = rng.nextInt(1, 3);
      base.overall = Math.min(97, base.overall + surpriseBoost);
      base.reputation = Math.min(99, base.reputation + rng.nextInt(2, 5));
    }

    teamBases[teamId] = base;
  }

  // Update season state awards
  const seasonState: SeasonState = {
    ...world.seasonState,
    completed: true,
    awards: {
      league1Champion,
      league1RunnerUp: world.league1Standings[1]?.teamId,
      league2Champion,
      league3Champion,
      leagueCupWinner,
      leagueCupRunnerUp: world.leagueCup.rounds.at(-1)?.fixtures[0]
        ? (world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId === leagueCupWinner
          ? world.leagueCup.rounds.at(-1)!.fixtures[0].awayTeamId
          : world.leagueCup.rounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      superCupWinner,
      superCupRunnerUp: world.superCup.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === superCupWinner
          ? world.superCup.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.superCup.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      worldCupWinner,
      worldCupRunnerUp: world.worldCup?.knockoutRounds.at(-1)?.fixtures[0]
        ? (world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId === worldCupWinner
          ? world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].awayTeamId
          : world.worldCup!.knockoutRounds.at(-1)!.fixtures[0].homeTeamId)
        : undefined,
      promoted: actualPromoted.map((p) => p.teamId),
      relegated: actualRelegated.map((r) => r.teamId),
    },
  };

  // ── Settle prediction ──
  let prediction = world.prediction;
  if (prediction && !prediction.settled) {
    const relegatedTeamIds = actualRelegated.map(r => r.teamId);
    let correct = 0;
    if (prediction.champion === league1Champion) correct++;
    if (relegatedTeamIds.includes(prediction.relegated)) correct++;
    prediction = { ...prediction, settled: true, correctCount: correct };
  }

  const updatedWorld: GameWorld = {
    ...world,
    seasonState,
    teamBases,
    teamStates,
    teamTrophies,
    coachTrophies,
    teamSeasonRecords,
    honorHistory,
    achievements,
    prediction,
    activeEvents: [],
    newsLog: [...world.newsLog, ...news],
    rngState: rng.getState(),
  };

  // Check for world cup year — caller handles the transition
  if (seasonState.isWorldCupYear) {
    return initializeWorldCup(updatedWorld);
  }

  return updatedWorld;
}

/**
 * Initialize the world cup phase after a world cup year season ends.
 */
export function initializeWorldCup(world: GameWorld): GameWorld {
  const seasonNumber = world.seasonState.seasonNumber;
  const rng = new SeededRNG(world.rngState);

  // Select participants: all 32 teams
  const allTeamIds = getAllTeamIds(world.teamStates);
  const teamOveralls: Record<string, number> = {};
  for (const id of allTeamIds) {
    teamOveralls[id] = world.teamBases[id]?.overall ?? 0;
  }
  const participants = selectWorldCupParticipants(allTeamIds, teamOveralls);

  // Initialize world cup
  const worldCup = initWorldCup(participants, seasonNumber, rng);

  // Get group fixtures for all 6 rounds
  const groupRoundFixtures: CupFixture[][] = [];
  for (let r = 1; r <= 6; r++) {
    const roundFixtures: CupFixture[] = [];
    for (const group of worldCup.groups) {
      for (const fixture of group.fixtures) {
        if (fixture.round === r) {
          roundFixtures.push(fixture);
        }
      }
    }
    groupRoundFixtures.push(roundFixtures);
  }

  // Append world cup windows to the calendar
  const calendar = appendWorldCupWindows(
    world.seasonState.calendar,
    seasonNumber,
    groupRoundFixtures,
  );

  // Update season state to continue into world cup phase
  const seasonState: SeasonState = {
    ...world.seasonState,
    calendar,
    completed: false,
    worldCupPhase: true,
    // Reset current window to the first world cup window
    currentWindowIndex: world.seasonState.calendar.length, // starts at first new window
  };

  // WC draw news
  const wcGroupInfo = worldCup.groups.map(g =>
    `${g.groupName}组: ${g.teamIds.map(id => world.teamBases[id]?.name?.slice(0, 3) ?? id).join('/')}`
  ).join(' | ');
  const wcDrawNews: NewsItem = {
    id: `draw-wc-S${seasonNumber}`,
    seasonNumber, windowIndex: world.seasonState.calendar.length, type: 'trophy',
    title: `环球冠军杯抽签揭晓 — 32队8组`,
    description: wcGroupInfo,
  };

  return {
    ...world,
    seasonState,
    worldCup,
    newsLog: [...world.newsLog, wcDrawNews],
    rngState: rng.getState(),
  };
}

/**
 * Finalize the world cup phase: patch honors, trophies, records with WC results,
 * then initialize the next season.
 */
export function finalizeWorldCup(world: GameWorld): GameWorld {
  let updatedWorld = { ...world };

  const wcWinnerId = updatedWorld.worldCup?.winnerId;
  if (wcWinnerId) {
    const sn = updatedWorld.seasonState.seasonNumber;
    const honorHistory = [...updatedWorld.honorHistory];
    const lastHonor = honorHistory[honorHistory.length - 1];

    // Determine WC runner-up
    const wcFinal = updatedWorld.worldCup!.knockoutRounds.at(-1)?.fixtures[0];
    const wcRunnerUp = wcFinal
      ? (wcFinal.homeTeamId === wcWinnerId ? wcFinal.awayTeamId : wcFinal.homeTeamId)
      : undefined;

    if (lastHonor && lastHonor.seasonNumber === sn && !lastHonor.worldCupWinner) {
      honorHistory[honorHistory.length - 1] = {
        ...lastHonor,
        worldCupWinner: wcWinnerId,
      };
    }

    // Add WC trophy to winner
    const teamTrophies = { ...updatedWorld.teamTrophies };
    teamTrophies[wcWinnerId] = [...(teamTrophies[wcWinnerId] ?? []), { type: 'world_cup' as const, seasonNumber: sn }];

    // Add to coach trophies
    const coachTrophies = { ...updatedWorld.coachTrophies };
    const winnerCoachId = updatedWorld.teamStates[wcWinnerId]?.currentCoachId;
    if (winnerCoachId) {
      coachTrophies[winnerCoachId] = [...(coachTrophies[winnerCoachId] ?? []), { type: 'world_cup' as const, seasonNumber: sn }];
    }

    // Patch team season records with WC results
    const teamSeasonRecords = { ...updatedWorld.teamSeasonRecords };
    for (const teamId of getAllTeamIds(updatedWorld.teamStates)) {
      const recs = teamSeasonRecords[teamId];
      if (!recs || recs.length === 0) continue;
      const lastRec = recs[recs.length - 1];
      if (lastRec.seasonNumber !== sn) continue;
      let wcResult = '';
      if (teamId === wcWinnerId) wcResult = '冠军';
      else if (teamId === wcRunnerUp) wcResult = '亚军';
      else if (updatedWorld.worldCup!.participantIds?.includes(teamId)) {
        const inSF = updatedWorld.worldCup!.knockoutRounds.find(r => r.roundName === 'SF')
          ?.fixtures.some(f => f.homeTeamId === teamId || f.awayTeamId === teamId);
        wcResult = inSF ? '四强' : '参赛';
      }
      if (wcResult) {
        const updated = [...recs];
        updated[updated.length - 1] = { ...lastRec, worldCupResult: wcResult };
        teamSeasonRecords[teamId] = updated;
      }
    }

    updatedWorld = { ...updatedWorld, honorHistory, teamTrophies, coachTrophies, teamSeasonRecords };
  }

  return updatedWorld;
}
