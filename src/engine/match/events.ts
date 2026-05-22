import { MatchEvent, CompetitionType } from '../../types';
import { Player } from '../../types/player';
import { SeededRNG } from './rng';

// ── Goal description pools (Chinese) ──────────────────────────────

const OPEN_PLAY_GOALS = [
  '底线附近低射破门',
  '禁区外弧线球破门',
  '精准传中头球攻门得手',
  '精妙配合后近距离推射入网',
  '25码外大力抽射破门',
  '反击中冷静推射得手',
  '单刀面对门将轻巧挑射',
  '凌空抽射直挂球门死角',
  '防守失误后果断射门得分',
  '人丛中劲射穿透防线',
  '折射球令门将措手不及',
  '挑射越过出击的门将',
  '小角度低射钻入远角',
  '门前混战中捅射入网',
  '精彩个人突破后射门得分',
  '禁区内转身抽射破门',
  '巧妙跑位后包抄推射',
  '长途奔袭后怒射入网',
  '二过一配合后轻松推射',
  '胸部停球后凌空抽射',
];

const SET_PIECE_GOALS = [
  '任意球绕过人墙直入球门',
  '角球头球攻门得手',
  '战术角球后远射破门',
  '定位球头球力压防守球员破门',
  '角球引发混战后补射入网',
];

const PENALTY_GOALS = [
  '点球命中，骗过门将方向',
  '点球大力轰向球门中路',
  '点球推射左下角入网',
  '点球推射右下角入网',
];

const SAVE_DESCRIPTIONS = [
  '门将飞身扑救将球托出',
  '近距离条件反射式扑救',
  '强有力的掌挡将球击出横梁',
  '精彩的一对一扑救',
  '极限指尖扑救力拒射门',
  '门将神勇鱼跃扑救化解险情',
  '门将双掌将皮球牢牢抱住',
];

const MISS_DESCRIPTIONS = [
  '好位置射门打飞了',
  '禁区外射门偏出立柱',
  '单刀射门拉偏远角',
  '头球顶高了横梁',
  '后点包抄射门偏出',
  '大力射门击中横梁弹出',
];

const YELLOW_CARD_DESCRIPTIONS = [
  '飞铲犯规被黄牌警告',
  '鲁莽犯规领到黄牌',
  '累计犯规被出示黄牌',
  '战术犯规阻止反击吃牌',
  '向裁判抗议被黄牌警告',
  '拖延时间被黄牌警告',
  '拉拽进攻球员被出牌',
  '手球犯规被出示黄牌',
  '背后铲球被警告',
];

const RED_CARD_DESCRIPTIONS = [
  '恶意犯规被直接红牌罚下',
  '两黄变一红被罚下场',
  '暴力行为被直接红牌',
  '阻止明显得分机会被红牌罚下',
];

const PENALTY_SHOOTOUT_GOAL = [
  '冷静推射命中球门角落',
  '大力抽射命中上角，门将毫无办法',
  '骗过门将方向从容罚进',
  '果断推射正中球门中路得手',
];

const PENALTY_SHOOTOUT_MISS = [
  '点球被门将扑出！',
  '点球打飞了横梁！',
  '点球击中立柱弹出！',
  '点球力量不足被门将轻松扑住',
];

// ── Player picking helpers ────────────────────────────────────────

/**
 * Pick a player from the squad weighted by position relevance and goalScoring stat.
 * positionWeights maps position to a base weight multiplier.
 * The goalScoring stat is then used as additional weighting for scoring events.
 *
 * v18 — `isBigMatch=true` boosts clutch-tagged players by ×1.3 on their
 * weight, so cup finals + derbies see "决赛先生" types over-represented
 * in the scorer pool. No effect for non-clutch players.
 */
function pickPlayer(
  squad: Player[],
  positionWeights: Record<string, number>,
  rng: SeededRNG,
  useGoalScoring: boolean = false,
  isBigMatch: boolean = false,
): Player {
  const weights = squad.map((p) => {
    const posWeight = positionWeights[p.position] ?? 1;
    const scoringWeight = useGoalScoring ? Math.max(1, p.goalScoring) : 10;
    const clutchMul = isBigMatch && p.tag === 'clutch' ? 1.3 : 1;
    return posWeight * scoringWeight * clutchMul;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * total;

  for (let i = 0; i < squad.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return squad[i];
  }

  return squad[squad.length - 1];
}

/**
 * Pick a goal scorer: heavily weighted toward FW, then MF, rarely DF.
 */
function pickGoalScorer(squad: Player[], rng: SeededRNG, isBigMatch: boolean = false): Player {
  return pickPlayer(
    squad,
    { FW: 10, MF: 4, DF: 1, GK: 0.05 },
    rng,
    true,
    isBigMatch,
  );
}

function pickAssistProvider(squad: Player[], scorerUuid: string, rng: SeededRNG): Player {
  const candidates = squad.filter(p => p.uuid !== scorerUuid);
  if (candidates.length === 0) return squad[0];
  return pickPlayer(
    candidates,
    { MF: 10, FW: 6, DF: 3, GK: 0.1 },
    rng,
    false,
  );
}

/**
 * Pick a player for yellow/red cards: mostly DF and MF.
 */
function pickCardPlayer(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { DF: 10, MF: 6, FW: 3, GK: 1 },
    rng,
    false,
  );
}

/**
 * Pick a GK from the squad (prefer #1 or lowest-numbered GK).
 */
function pickGoalkeeper(squad: Player[]): Player {
  const gks = squad.filter((p) => p.position === 'GK');
  if (gks.length === 0) return squad[0]; // fallback
  // Prefer #1 if available, otherwise lowest numbered GK
  const gk1 = gks.find((p) => p.number === 1);
  if (gk1) return gk1;
  gks.sort((a, b) => a.number - b.number);
  return gks[0];
}

/**
 * Pick a player for misses: FW and MF mostly.
 */
function pickMissPlayer(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { FW: 8, MF: 5, DF: 1, GK: 0.1 },
    rng,
    true,
  );
}

/**
 * Format a description with optional player name + number prefix.
 */
function formatDescription(
  description: string,
  playerNumber?: number,
  playerName?: string,
): string {
  if (playerName) {
    return `${playerName} ${description}`;
  }
  if (playerNumber !== undefined) {
    return `${playerNumber}号 ${description}`;
  }
  return description;
}

// ── Minute weighting ───────────────────────────────────────────────

/**
 * Goals tend to cluster in certain periods:
 * - Just before half time (40-45)
 * - After the hour mark (60-75)
 * - Late drama (85-90+)
 * This returns a weighted minute for a goal.
 */
function weightedGoalMinute(maxMinute: number, rng: SeededRNG): number {
  const r = rng.next();

  if (maxMinute <= 90) {
    // Normal time distribution
    if (r < 0.08) return rng.nextInt(1, 10); // early
    if (r < 0.2) return rng.nextInt(11, 25); // mid first half
    if (r < 0.35) return rng.nextInt(26, 39); // late first half
    if (r < 0.5) return rng.nextInt(40, 45); // just before HT (clustered)
    if (r < 0.58) return rng.nextInt(46, 55); // early second half
    if (r < 0.75) return rng.nextInt(56, 69); // mid second half
    if (r < 0.9) return rng.nextInt(70, 84); // after 70' (clustered)
    return rng.nextInt(85, 90); // late drama
  }

  // Extra time distribution (goals in 91-120)
  if (r < 0.55) {
    // 55% of ET goals in first period
    return rng.nextInt(91, 105);
  }
  return rng.nextInt(106, 120);
}

function randomMinuteInRange(
  min: number,
  max: number,
  rng: SeededRNG,
): number {
  return rng.nextInt(min, max);
}

// ── Main export ────────────────────────────────────────────────────

export function generateMatchEvents(
  homeGoals: number,
  awayGoals: number,
  homeTeamId: string,
  awayTeamId: string,
  _competitionType: CompetitionType,
  rng: SeededRNG,
  extraTime: boolean,
  penaltyHome?: number,
  penaltyAway?: number,
  homeSquad?: Player[],
  awaySquad?: Player[],
  etHomeGoals: number = 0,
  etAwayGoals: number = 0,
  isBigMatch: boolean = false,
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const maxNormalMinute = 90;
  const maxMinute = extraTime ? 120 : 90;

  // Helper to get squad for a team (may be undefined for backward compat)
  function getSquad(teamId: string): Player[] | undefined {
    if (teamId === homeTeamId) return homeSquad;
    if (teamId === awayTeamId) return awaySquad;
    return undefined;
  }

  // ── Generate goals ───────────────────────────────────────────────

  const generateGoalEvents = (
    goals: number,
    teamId: string,
    isET: boolean,
  ): void => {
    const squad = getSquad(teamId);

    for (let i = 0; i < goals; i++) {
      const minute = isET
        ? weightedGoalMinute(120, rng)
        : weightedGoalMinute(90, rng);

      // ~10% of goals are from set pieces, ~8% are penalties in open play
      const roll = rng.next();
      let description: string;
      let isPenalty = false;
      if (roll < 0.08) {
        description = rng.pick(PENALTY_GOALS);
        isPenalty = true;
      } else if (roll < 0.18) {
        description = rng.pick(SET_PIECE_GOALS);
      } else {
        description = rng.pick(OPEN_PLAY_GOALS);
      }

      // Pick a scorer if squad is available
      let playerId: string | undefined;
      let playerNumber: number | undefined;
      let playerName: string | undefined;
      if (squad) {
        const scorer = pickGoalScorer(squad, rng, isBigMatch);
        playerId = scorer.uuid;
        playerNumber = scorer.number;
        playerName = scorer.name;
      }

      events.push({
        minute,
        type: 'goal',
        teamId,
        playerId,
        playerNumber,
        playerName,
        description: formatDescription(description, playerNumber, playerName),
      });

      // ~70% of non-penalty goals have an assist
      if (squad && playerId && !isPenalty && rng.next() < 0.70) {
        const assister = pickAssistProvider(squad, playerId, rng);
        events.push({
          minute,
          type: 'assist',
          teamId,
          playerId: assister.uuid,
          playerNumber: assister.number,
          playerName: assister.name,
          description: `${assister.name ?? assister.number + '号'} 送出助攻`,
        });
      }
    }
  };

  // Regulation goals
  generateGoalEvents(homeGoals, homeTeamId, false);
  generateGoalEvents(awayGoals, awayTeamId, false);

  // Extra time goals (separate so they get 91-120 minute range)
  if (extraTime) {
    generateGoalEvents(etHomeGoals, homeTeamId, true);
    generateGoalEvents(etAwayGoals, awayTeamId, true);
  }

  // ── Yellow cards (2-6 per match) ─────────────────────────────────

  const totalYellows = rng.nextInt(2, 6);
  for (let i = 0; i < totalYellows; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(YELLOW_CARD_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad) {
      const player = pickCardPlayer(squad, rng);
      playerId = player.uuid;
      playerNumber = player.number;
      playerName = player.name;
    }

    events.push({
      minute,
      type: 'yellow_card',
      teamId,
      playerId,
      playerNumber,
      playerName,
      description: formatDescription(description, playerNumber, playerName),
    });
  }

  // ── Red cards (rare, ~6% chance per match, max 1 usually) ───────

  if (rng.next() < 0.06) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(20, maxMinute, rng);
    const description = rng.pick(RED_CARD_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad) {
      const player = pickCardPlayer(squad, rng);
      playerId = player.uuid;
      playerNumber = player.number;
      playerName = player.name;
    }

    events.push({
      minute,
      type: 'red_card',
      teamId,
      playerId,
      playerNumber,
      playerName,
      description: formatDescription(description, playerNumber, playerName),
    });
  }

  // ── Key saves (1-4) ──────────────────────────────────────────────

  const totalSaves = rng.nextInt(1, 4);
  for (let i = 0; i < totalSaves; i++) {
    // Saves are attributed to the keeper's team
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(SAVE_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad) {
      const gk = pickGoalkeeper(squad);
      playerId = gk.uuid;
      playerNumber = gk.number;
      playerName = gk.name;
    }

    events.push({
      minute,
      type: 'save',
      teamId,
      playerId,
      playerNumber,
      playerName,
      description: formatDescription(description, playerNumber, playerName),
    });
  }

  // ── Near misses (1-3) ────────────────────────────────────────────

  const totalMisses = rng.nextInt(1, 3);
  for (let i = 0; i < totalMisses; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(1, maxMinute, rng);
    const description = rng.pick(MISS_DESCRIPTIONS);
    const squad = getSquad(teamId);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad) {
      const player = pickMissPlayer(squad, rng);
      playerId = player.uuid;
      playerNumber = player.number;
      playerName = player.name;
    }

    events.push({
      minute,
      type: 'miss',
      teamId,
      playerId,
      playerNumber,
      playerName,
      description: formatDescription(description, playerNumber, playerName),
    });
  }

  // ── Penalty shootout events ──────────────────────────────────────

  if (penaltyHome !== undefined && penaltyAway !== undefined) {
    // Simulate a realistic shootout order.
    // Standard: 5 rounds, then sudden death.
    const homeScored = penaltyHome;
    const awayScored = penaltyAway;
    const totalPens = Math.max(homeScored + awayScored, 6); // at least 3 rounds each
    const maxRounds = Math.ceil(totalPens / 2);

    let homeRemaining = homeScored;
    let awayRemaining = awayScored;
    let penMinute = maxNormalMinute + (extraTime ? 30 : 0) + 1; // 121 typically

    for (let round = 0; round < maxRounds; round++) {
      // Home takes
      const homeShooterSquad = homeSquad;
      let homeShooterPlayerId: string | undefined;
      let homeShooterNumber: number | undefined;
      let homeShooterName: string | undefined;
      if (homeShooterSquad) {
        // Pick from outfield players for shootout
        const outfield = homeShooterSquad.filter((p) => p.position !== 'GK');
        const shooter =
          outfield.length > 0
            ? pickPlayer(outfield, { FW: 8, MF: 5, DF: 2, GK: 0 }, rng, true)
            : homeShooterSquad[0];
        homeShooterPlayerId = shooter.uuid;
        homeShooterNumber = shooter.number;
        homeShooterName = shooter.name;
      }

      if (homeRemaining > 0) {
        const desc = rng.pick(PENALTY_SHOOTOUT_GOAL);
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: homeTeamId,
          playerId: homeShooterPlayerId,
          playerNumber: homeShooterNumber,
          playerName: homeShooterName,
          description: formatDescription(desc, homeShooterNumber, homeShooterName),
        });
        homeRemaining--;
      } else {
        const desc = rng.pick(PENALTY_SHOOTOUT_MISS);
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: homeTeamId,
          playerId: homeShooterPlayerId,
          playerNumber: homeShooterNumber,
          playerName: homeShooterName,
          description: formatDescription(desc, homeShooterNumber, homeShooterName),
        });
      }
      penMinute++;

      // Away takes
      const awayShooterSquad = awaySquad;
      let awayShooterPlayerId: string | undefined;
      let awayShooterNumber: number | undefined;
      let awayShooterName: string | undefined;
      if (awayShooterSquad) {
        const outfield = awayShooterSquad.filter((p) => p.position !== 'GK');
        const shooter =
          outfield.length > 0
            ? pickPlayer(outfield, { FW: 8, MF: 5, DF: 2, GK: 0 }, rng, true)
            : awayShooterSquad[0];
        awayShooterPlayerId = shooter.uuid;
        awayShooterNumber = shooter.number;
        awayShooterName = shooter.name;
      }

      if (awayRemaining > 0) {
        const desc = rng.pick(PENALTY_SHOOTOUT_GOAL);
        events.push({
          minute: penMinute,
          type: 'penalty_goal',
          teamId: awayTeamId,
          playerId: awayShooterPlayerId,
          playerNumber: awayShooterNumber,
          playerName: awayShooterName,
          description: formatDescription(desc, awayShooterNumber, awayShooterName),
        });
        awayRemaining--;
      } else {
        const desc = rng.pick(PENALTY_SHOOTOUT_MISS);
        events.push({
          minute: penMinute,
          type: 'penalty_miss',
          teamId: awayTeamId,
          playerId: awayShooterPlayerId,
          playerNumber: awayShooterNumber,
          playerName: awayShooterName,
          description: formatDescription(desc, awayShooterNumber, awayShooterName),
        });
      }
      penMinute++;
    }
  }

  // ── Sort all events chronologically ──────────────────────────────

  events.sort((a, b) => a.minute - b.minute);

  // ── Add contextual labels to goals (扳平/反超/锁定胜局) ──────────

  let runHome = 0;
  let runAway = 0;
  for (const ev of events) {
    if (ev.type !== 'goal' && ev.type !== 'penalty_goal' && ev.type !== 'own_goal') continue;
    const isHomeGoal = ev.teamId === homeTeamId;
    if (isHomeGoal) runHome++; else runAway++;

    // Determine context
    let ctx = '';
    if (runHome === runAway) {
      ctx = '扳平比分！';
    } else if (isHomeGoal && runHome === runAway + 1 && runAway > 0) {
      ctx = '反超比分！';
    } else if (!isHomeGoal && runAway === runHome + 1 && runHome > 0) {
      ctx = '反超比分！';
    } else if (ev.minute >= 85) {
      const lead = isHomeGoal ? runHome - runAway : runAway - runHome;
      if (lead === 1) ctx = '绝杀！';
      else if (lead >= 2) ctx = '锁定胜局';
    } else if ((runHome >= 3 && isHomeGoal) || (runAway >= 3 && !isHomeGoal)) {
      const count = isHomeGoal ? runHome : runAway;
      if (count === 3) ctx = '帽子戏法！';
    }

    if (ctx) {
      ev.description = `${ev.description} [${ctx}]`;
    }
  }

  return events;
}

// ═══════════════════════════════════════════════════════════════════
// v22 — Symmetric "denied goal" pipeline (post-Poisson interception)
// ═══════════════════════════════════════════════════════════════════
//
// For each `goal` event the simulator already generated, this pipeline
// rolls a `deny` chance (5-18% based on the defending team's best GK
// rating). If denied:
//   1. The `goal` event is REMOVED from the events array.
//   2. The paired `assist` event (if present) is ALSO removed.
//   3. A new `gk_save` (60%) or `df_block` (40%) event is inserted at
//      the same minute, carrying `deniedScorerId` + `deniedAssisterId`
//      payload so the stats pipeline can credit `bigChances` /
//      `keyPasses` without affecting `goals` / `assists`.
//
// SCORE RECONCILIATION CONTRACT:
// After this function returns, `regHomeGoals` / `etHomeGoals` etc. MUST
// be RE-DERIVED from the returned events by the caller (simulator.ts).
// Do NOT trust the original Poisson counts after deny applies.
//
// BALANCE CONTRACT:
// Deny rate is intentionally capped at 18% (elite GK with rating 95+)
// and floors at 5% (any GK). Total league goal count drops ~5-8% — a
// conservative shift that yields more 1-0 / 2-1 dramatic finishes
// without destabilising the season-wide point totals.

const GK_SAVE_DESCRIPTIONS = [
  '门将神勇扑救！必进球被化解',
  '门将极限指尖救险，本是必入球',
  '门将神扑！将十拿九稳的进球拒之门外',
  '门将世界波扑救！全场起立致敬',
  '关键扑救！门将以一己之力拒绝进球',
];

const DF_BLOCK_DESCRIPTIONS = [
  '后卫飞身门线解围！皮球已过门将',
  '关键时刻后卫挺身门线封堵',
  '门线技术！后卫将必进球挡出',
  '惊险解围！皮球离门线仅一指距离',
  '后卫舍身堵枪眼，化解必入球',
];

/** Compute the defending team's deny probability for a single goal. */
function denyRateForTeam(squad: Player[] | undefined): number {
  if (!squad || squad.length === 0) return 0.05;
  const gks = squad.filter(p => p.position === 'GK');
  if (gks.length === 0) return 0.05;
  // Use the highest-rated GK on the squad (i.e. the likely starter).
  const bestGk = gks.reduce((a, b) => (a.rating > b.rating ? a : b));
  // Base 5%, +1% per rating point above 70, hard cap at 18%.
  const bonus = Math.max(0, bestGk.rating - 70) * 0.01;
  return Math.min(0.18, 0.05 + bonus);
}

/** Weighted-random pick of a DF from the squad, biased toward higher rating. */
function pickDefender(squad: Player[], rng: SeededRNG): Player | null {
  const dfs = squad.filter(p => p.position === 'DF');
  if (dfs.length === 0) return null;
  // Weight = rating^2 so star defenders accumulate more blocks naturally.
  const weights = dfs.map(d => d.rating * d.rating);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * totalWeight;
  for (let i = 0; i < dfs.length; i++) {
    r -= weights[i];
    if (r <= 0) return dfs[i];
  }
  return dfs[dfs.length - 1];
}

/**
 * Apply the deny pipeline in-place to a generated events array.
 *
 * Returns a NEW events array (does not mutate the input). Caller must
 * re-derive `regHomeGoals` / `regAwayGoals` / `etHomeGoals` /
 * `etAwayGoals` from the returned events by filtering on type==='goal'.
 *
 * NOTE: penalty shootout events (minute > 120) are NOT subject to deny;
 * we don't want the dramatic "saved shootout penalty" to also count as a
 * regular save, since shootouts are scored separately. Own goals
 * (`own_goal` type) are also excluded — a defender can't save themselves.
 */
export function applyDenyPipeline(
  events: MatchEvent[],
  homeTeamId: string,
  awayTeamId: string,
  homeSquad: Player[] | undefined,
  awaySquad: Player[] | undefined,
  rng: SeededRNG,
): MatchEvent[] {
  const homeDenyRate = denyRateForTeam(awaySquad); // home goals denied by AWAY defence
  const awayDenyRate = denyRateForTeam(homeSquad); // away goals denied by HOME defence
  const out: MatchEvent[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    // Only regulation/ET goals are denyable. Shootouts (>120 min) and own
    // goals are passed through untouched.
    const isDenyable =
      ev.type === 'goal' &&
      ev.minute <= 120 &&
      (ev.teamId === homeTeamId || ev.teamId === awayTeamId);
    if (!isDenyable) {
      out.push(ev);
      i++;
      continue;
    }
    const isHome = ev.teamId === homeTeamId;
    const denyRate = isHome ? homeDenyRate : awayDenyRate;
    const defendingSquad = isHome ? awaySquad : homeSquad;
    const roll = rng.next();
    if (roll >= denyRate || !defendingSquad) {
      // Goal survives. Push as-is, and push the paired assist event too
      // (without re-rolling deny on it — it's not a goal).
      out.push(ev);
      i++;
      // The event generator pushes `assist` immediately after a `goal`
      // with the same minute + teamId. Pair them.
      if (
        i < events.length &&
        events[i].type === 'assist' &&
        events[i].teamId === ev.teamId &&
        events[i].minute === ev.minute
      ) {
        out.push(events[i]);
        i++;
      }
      continue;
    }
    // ── DENY FIRES ──────────────────────────────────────────────────
    // Find the paired assist (if any) to carry into the save/block event.
    let assisterId: string | undefined;
    let consumeAssist = false;
    if (
      i + 1 < events.length &&
      events[i + 1].type === 'assist' &&
      events[i + 1].teamId === ev.teamId &&
      events[i + 1].minute === ev.minute
    ) {
      assisterId = events[i + 1].playerId;
      consumeAssist = true;
    }
    // Pick GK or DF for credit. 60/40 split.
    const useGk = rng.next() < 0.6;
    if (useGk) {
      const gk = pickGoalkeeper(defendingSquad);
      out.push({
        minute: ev.minute,
        type: 'gk_save',
        teamId: isHome ? awayTeamId : homeTeamId, // credit DEFENDING side
        playerId: gk.uuid,
        playerNumber: gk.number,
        playerName: gk.name,
        description: rng.pick(GK_SAVE_DESCRIPTIONS),
        deniedScorerId: ev.playerId,
        ...(assisterId !== undefined && { deniedAssisterId: assisterId }),
      });
    } else {
      const df = pickDefender(defendingSquad, rng);
      if (df) {
        out.push({
          minute: ev.minute,
          type: 'df_block',
          teamId: isHome ? awayTeamId : homeTeamId,
          playerId: df.uuid,
          playerNumber: df.number,
          playerName: df.name,
          description: rng.pick(DF_BLOCK_DESCRIPTIONS),
          deniedScorerId: ev.playerId,
          ...(assisterId !== undefined && { deniedAssisterId: assisterId }),
        });
      } else {
        // No DF available — fall back to GK so we don't lose attribution.
        const gk = pickGoalkeeper(defendingSquad);
        out.push({
          minute: ev.minute,
          type: 'gk_save',
          teamId: isHome ? awayTeamId : homeTeamId,
          playerId: gk.uuid,
          playerNumber: gk.number,
          playerName: gk.name,
          description: rng.pick(GK_SAVE_DESCRIPTIONS),
          deniedScorerId: ev.playerId,
          ...(assisterId !== undefined && { deniedAssisterId: assisterId }),
        });
      }
    }
    // Advance past the goal (and assist, if consumed).
    i += consumeAssist ? 2 : 1;
  }
  return out;
}
