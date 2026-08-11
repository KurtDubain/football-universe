import {
  MatchEvent,
  CompetitionType,
  PenaltyShootoutKick,
  type MatchPlayOrigin,
  type MatchSetPieceContext,
  type MatchStats,
} from '../../types';
import { Player } from '../../types/player';
import type { MatchApproach } from '../../types/coach';
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

const COUNTER_GOALS = [
  '快速反击中直塞身后，单刀冷静推射得手',
  '后场断球后纵向推进，接应传中包抄破门',
  '防守反击形成多打少，禁区内低射入网',
  '长传发动转换，前锋抢在回防前完成破门',
];

const FREE_KICK_GOALS = [
  '任意球绕过人墙直入球门',
  '任意球传入禁区后头球破门',
];

const CORNER_GOALS = [
  '角球头球攻门得手',
  '战术角球后远射破门',
  '定位球头球力压防守球员破门',
  '角球引发混战后补射入网',
];

const CORNER_MISSES = [
  '角球开向前点，甩头攻门偏出',
  '后点接到角球凌空抽射打高',
  '战术角球传中，门前包抄差了一步',
];

const FREE_KICK_MISSES = [
  '任意球越过人墙稍稍高出横梁',
  '定位球传入禁区，头球攻门偏出',
  '任意球直奔远角，擦着立柱偏出',
];

const STANDALONE_CORNERS = {
  cleared: [
    '角球开向禁区，第一点被防守球员解围',
    '角球寻找后点，门将出击将球击出',
  ],
  retained: [
    '战术角球拉开宽度，进攻方继续控制球权',
    '角球被顶出禁区，进攻方拿到第二点',
  ],
};

const STANDALONE_FREE_KICKS = {
  cleared: [
    '任意球传入禁区，防线保持住位置完成解围',
    '定位球越过人墙，门将稳稳将球摘下',
  ],
  retained: [
    '任意球被挡出后，进攻方在外围重新组织',
    '战术任意球短传开出，进攻继续推进',
  ],
};

const PENALTY_GOALS = [
  '点球命中，骗过门将方向',
  '点球大力轰向球门中路',
  '点球推射左下角入网',
  '点球推射右下角入网',
];

const MISS_DESCRIPTIONS = [
  '好位置射门打飞了',
  '禁区外射门偏出立柱',
  '单刀射门拉偏远角',
  '头球顶高了横梁',
  '后点包抄射门偏出',
  '大力射门击中横梁弹出',
];

const COUNTER_MISSES = [
  '快速反击形成单刀，最后一脚稍稍偏出',
  '纵向转换撕开防线，仓促射门越过横梁',
  '反击中接到横传，包抄射门被立柱拒绝',
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

const PENALTY_SHOOTOUT_SAVED = [
  '点球被门将扑出！',
  '点球力量不足被门将稳稳抱住！',
];

const PENALTY_SHOOTOUT_OFF_TARGET = [
  '点球打飞了横梁！',
  '点球偏出立柱！',
];

const PENALTY_SHOOTOUT_WOODWORK = [
  '点球击中立柱弹出！',
  '点球重重砸在横梁上！',
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
  abilityWeight: number = 0,
): Player {
  const weights = squad.map((p) => {
    const posWeight = positionWeights[p.position] ?? 1;
    const scoringWeight = useGoalScoring ? Math.max(1, p.goalScoring) : 10;
    const clutchMul = isBigMatch && p.tag === 'clutch' ? 1.3 : 1;
    const abilityMultiplier = Math.max(0.55, 1 + ((p.rating - 60) / 40) * abilityWeight);
    return posWeight * scoringWeight * clutchMul * abilityMultiplier;
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
    0.35,
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
    false,
    0.7,
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
function pickGoalkeeper(squad: Player[]): Player | undefined {
  const gks = squad.filter((p) => p.position === 'GK');
  if (gks.length === 0) return undefined;
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
    false,
    0.25,
  );
}

function pickSetPieceTaker(squad: Player[], rng: SeededRNG): Player {
  return pickPlayer(
    squad,
    { MF: 10, FW: 6, DF: 3, GK: 0.05 },
    rng,
    false,
    false,
    0.9,
  );
}

function setPieceContext(
  origin: MatchPlayOrigin,
  rng: SeededRNG,
  resolution?: MatchSetPieceContext['resolution'],
): MatchSetPieceContext | undefined {
  if (origin === 'corner') {
    return {
      side: rng.next() < 0.5 ? 'left' : 'right',
      delivery: rng.pick(['near_post', 'far_post', 'central', 'cutback'] as const),
      ...(resolution && { resolution }),
    };
  }
  if (origin === 'direct_free_kick') {
    return { side: 'central', delivery: 'direct', ...(resolution && { resolution }) };
  }
  if (origin === 'crossed_free_kick') {
    return {
      side: rng.next() < 0.5 ? 'left' : 'right',
      delivery: rng.pick(['near_post', 'far_post', 'central'] as const),
      ...(resolution && { resolution }),
    };
  }
  if (origin === 'penalty') return { side: 'central', delivery: 'direct' };
  return undefined;
}

function buildPenaltyTakerOrder(squad: Player[] | undefined, rng: SeededRNG): Player[] {
  const remaining = (squad ?? []).filter(player => player.position !== 'GK');
  const order: Player[] = [];
  while (remaining.length > 0) {
    const selected = pickPlayer(remaining, { FW: 8, MF: 5, DF: 2, GK: 0 }, rng, true);
    order.push(selected);
    remaining.splice(remaining.findIndex(player => player.uuid === selected.uuid), 1);
  }
  return order;
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

export function counterOriginChance(approach: MatchApproach | undefined): number {
  switch (approach) {
    case 'counter': return 0.32;
    case 'low_block': return 0.23;
    case 'pressing': return 0.12;
    case 'control': return 0.08;
    default: return 0.14;
  }
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
  penaltyShootout?: PenaltyShootoutKick[],
  homeSquad?: Player[],
  awaySquad?: Player[],
  etHomeGoals: number = 0,
  etAwayGoals: number = 0,
  isBigMatch: boolean = false,
  homePlayersAtMinute?: (minute: number) => Player[],
  awayPlayersAtMinute?: (minute: number) => Player[],
  homeRedCardCandidatesAtMinute?: (minute: number) => Player[],
  awayRedCardCandidatesAtMinute?: (minute: number) => Player[],
  phase: 'full' | 'regulation' | 'extra_time' | 'shootout' = 'full',
  tacticalApproaches?: { home: MatchApproach; away: MatchApproach },
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const maxMinute = phase === 'regulation' ? 90 : extraTime ? 120 : 90;
  const isExtraTimeOnly = phase === 'extra_time';
  const isShootoutOnly = phase === 'shootout';
  const dismissedAt = new Map<string, number>();

  function getSquad(teamId: string, minute: number): Player[] | undefined {
    const squad = teamId === homeTeamId
      ? homePlayersAtMinute?.(minute) ?? homeSquad
      : teamId === awayTeamId
        ? awayPlayersAtMinute?.(minute) ?? awaySquad
        : undefined;
    return squad?.filter(player => (dismissedAt.get(player.uuid) ?? Number.POSITIVE_INFINITY) > minute);
  }

  function approachFor(teamId: string): MatchApproach | undefined {
    if (teamId === homeTeamId) return tacticalApproaches?.home;
    if (teamId === awayTeamId) return tacticalApproaches?.away;
    return undefined;
  }

  // Roll dismissal first so every later event picker can exclude a player
  // after their red-card minute. Output order is still chronological below.
  if (!isShootoutOnly && rng.next() < (isExtraTimeOnly ? 0.02 : 0.06)) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(isExtraTimeOnly ? 91 : 20, maxMinute, rng);
    const squad = teamId === homeTeamId
      ? homeRedCardCandidatesAtMinute?.(minute) ?? getSquad(teamId, minute)
      : awayRedCardCandidatesAtMinute?.(minute) ?? getSquad(teamId, minute);
    if (squad && squad.length > 0) {
      const player = pickCardPlayer(squad, rng);
      dismissedAt.set(player.uuid, minute);
      events.push({
        minute,
        type: 'red_card',
        teamId,
        playerId: player.uuid,
        playerNumber: player.number,
        playerName: player.name,
        description: formatDescription(rng.pick(RED_CARD_DESCRIPTIONS), player.number, player.name),
      });
    }
  }

  // ── Generate goals ───────────────────────────────────────────────

  const generateGoalEvents = (
    goals: number,
    teamId: string,
    isET: boolean,
  ): void => {
    for (let i = 0; i < goals; i++) {
      const minute = isET
        ? weightedGoalMinute(120, rng)
        : weightedGoalMinute(90, rng);
      const squad = getSquad(teamId, minute);

      // ~10% of goals are from set pieces, ~8% are penalties in open play
      const roll = rng.next();
      let description: string;
      let isPenalty = false;
      let playOrigin: MatchPlayOrigin = 'open_play';
      let setPiece: MatchSetPieceContext | undefined;
      if (roll < 0.08) {
        description = rng.pick(PENALTY_GOALS);
        isPenalty = true;
        playOrigin = 'penalty';
        setPiece = setPieceContext(playOrigin, rng);
      } else if (roll < 0.18) {
        playOrigin = rng.next() < 0.62 ? 'corner' : rng.next() < 0.45 ? 'direct_free_kick' : 'crossed_free_kick';
        description = playOrigin === 'corner' ? rng.pick(CORNER_GOALS) : rng.pick(FREE_KICK_GOALS);
        setPiece = setPieceContext(playOrigin, rng);
      } else {
        const isCounter = rng.next() < counterOriginChance(approachFor(teamId));
        playOrigin = isCounter ? 'counter' : 'open_play';
        description = rng.pick(isCounter ? COUNTER_GOALS : OPEN_PLAY_GOALS);
      }

      // Pick a scorer if squad is available
      let playerId: string | undefined;
      let playerNumber: number | undefined;
      let playerName: string | undefined;
      if (squad?.length) {
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
        playOrigin,
        ...(setPiece && { setPiece }),
      });

      // ~70% of non-penalty goals have an assist
      if (squad?.length && playerId && !isPenalty && rng.next() < 0.70) {
        const assister = pickAssistProvider(squad, playerId, rng);
        events.push({
          minute,
          type: 'assist',
          teamId,
          playerId: assister.uuid,
          playerNumber: assister.number,
          playerName: assister.name,
          description: `${assister.name ?? assister.number + '号'} 送出助攻`,
          playOrigin,
          ...(setPiece && { setPiece }),
        });
      }
    }
  };

  // Regulation goals
  if (!isExtraTimeOnly && !isShootoutOnly) {
    generateGoalEvents(homeGoals, homeTeamId, false);
    generateGoalEvents(awayGoals, awayTeamId, false);
  }

  // Extra time goals (separate so they get 91-120 minute range)
  if (extraTime && phase !== 'regulation' && !isShootoutOnly) {
    generateGoalEvents(etHomeGoals, homeTeamId, true);
    generateGoalEvents(etAwayGoals, awayTeamId, true);
  }

  // ── Yellow cards (2-6 per match) ─────────────────────────────────

  const totalYellows = isShootoutOnly ? 0 : isExtraTimeOnly ? rng.nextInt(0, 2) : rng.nextInt(2, 6);
  for (let i = 0; i < totalYellows; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(isExtraTimeOnly ? 91 : 1, maxMinute, rng);
    const description = rng.pick(YELLOW_CARD_DESCRIPTIONS);
    const squad = getSquad(teamId, minute);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad?.length) {
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

  // ── Near misses (1-3) ────────────────────────────────────────────

  const totalMisses = isShootoutOnly ? 0 : isExtraTimeOnly ? rng.nextInt(0, 1) : rng.nextInt(1, 3);
  for (let i = 0; i < totalMisses; i++) {
    const teamId = rng.next() < 0.5 ? homeTeamId : awayTeamId;
    const minute = randomMinuteInRange(isExtraTimeOnly ? 91 : 1, maxMinute, rng);
    const originRoll = rng.next();
    const openPlayRoll = Math.max(0, (originRoll - 0.17) / 0.83);
    const playOrigin: MatchPlayOrigin = originRoll < 0.1
      ? 'corner'
      : originRoll < 0.17
        ? (rng.next() < 0.45 ? 'direct_free_kick' : 'crossed_free_kick')
        : openPlayRoll < counterOriginChance(approachFor(teamId))
          ? 'counter'
          : 'open_play';
    const description = playOrigin === 'corner'
      ? rng.pick(CORNER_MISSES)
      : playOrigin === 'direct_free_kick' || playOrigin === 'crossed_free_kick'
        ? rng.pick(FREE_KICK_MISSES)
        : playOrigin === 'counter'
          ? rng.pick(COUNTER_MISSES)
          : rng.pick(MISS_DESCRIPTIONS);
    const setPiece = setPieceContext(playOrigin, rng);
    const squad = getSquad(teamId, minute);

    let playerId: string | undefined;
    let playerNumber: number | undefined;
    let playerName: string | undefined;
    if (squad?.length) {
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
      playOrigin,
      ...(setPiece && { setPiece }),
    });
  }

  // ── Penalty shootout events ──────────────────────────────────────

  if (penaltyShootout?.length) {
    const homeShootoutSquad = getSquad(homeTeamId, maxMinute);
    const awayShootoutSquad = getSquad(awayTeamId, maxMinute);
    const homeTakers = buildPenaltyTakerOrder(homeShootoutSquad, rng);
    const awayTakers = buildPenaltyTakerOrder(awayShootoutSquad, rng);
    const homeKeeper = pickGoalkeeper(homeShootoutSquad ?? []);
    const awayKeeper = pickGoalkeeper(awayShootoutSquad ?? []);

    for (const kick of penaltyShootout) {
      const takers = kick.team === 'home' ? homeTakers : awayTakers;
      const shooter = takers.length > 0 ? takers[(kick.teamKickNumber - 1) % takers.length] : undefined;
      const goalkeeper = kick.team === 'home' ? awayKeeper : homeKeeper;
      const descriptionPool = kick.outcome === 'scored'
        ? PENALTY_SHOOTOUT_GOAL
        : kick.outcome === 'saved'
          ? PENALTY_SHOOTOUT_SAVED
          : kick.outcome === 'woodwork'
            ? PENALTY_SHOOTOUT_WOODWORK
            : PENALTY_SHOOTOUT_OFF_TARGET;
      events.push({
        minute: maxMinute + kick.kickNumber,
        type: kick.outcome === 'scored' ? 'penalty_goal' : 'penalty_miss',
        teamId: kick.team === 'home' ? homeTeamId : awayTeamId,
        playerId: shooter?.uuid,
        playerNumber: shooter?.number,
        playerName: shooter?.name,
        description: formatDescription(rng.pick(descriptionPool), shooter?.number, shooter?.name),
        shootout: {
          ...kick,
          goalkeeperId: goalkeeper?.uuid,
          goalkeeperName: goalkeeper?.name,
        },
      });
    }
  }

  // ── Sort all events chronologically ──────────────────────────────

  events.sort((a, b) => a.minute - b.minute);

  // ── Add contextual labels to goals (扳平/反超/锁定胜局) ──────────

  let runHome = 0;
  let runAway = 0;
  for (const ev of events) {
    if (ev.type !== 'goal' && ev.type !== 'own_goal') continue;
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

function eventAttackingTeamId(event: MatchEvent, homeTeamId: string, awayTeamId: string): string {
  if (event.type === 'save' || event.type === 'gk_save' || event.type === 'df_block') {
    return event.teamId === homeTeamId ? awayTeamId : homeTeamId;
  }
  return event.teamId;
}

function chooseQuietMinute(events: MatchEvent[], maxMinute: number, rng: SeededRNG): number {
  const occupied = events.map(event => event.minute);
  let candidate = rng.nextInt(8, Math.max(9, maxMinute - 5));
  for (let attempt = 0; attempt < 16; attempt++) {
    if (occupied.every(minute => Math.abs(minute - candidate) > 2)) return candidate;
    candidate = rng.nextInt(8, Math.max(9, maxMinute - 5));
  }
  return candidate;
}

/**
 * Add only the set pieces worth showing in a live timeline. Full corner volume
 * remains in MatchStats, keeping long saves compact while making presentation
 * events authoritative rather than animation-only decoration.
 */
export function addNotableSetPieceEvents(
  events: MatchEvent[],
  stats: MatchStats,
  homeTeamId: string,
  awayTeamId: string,
  maxMinute: number,
  rng: SeededRNG,
  homePlayersAtMinute?: (minute: number) => Player[],
  awayPlayersAtMinute?: (minute: number) => Player[],
): MatchEvent[] {
  const next = [...events];
  const existingCorners = [homeTeamId, awayTeamId].map(teamId => next.filter(event => (
    event.playOrigin === 'corner'
    && eventAttackingTeamId(event, homeTeamId, awayTeamId) === teamId
  )).length);
  const remainingCorners = [
    Math.max(0, stats.corners[0] - existingCorners[0]),
    Math.max(0, stats.corners[1] - existingCorners[1]),
  ];
  const totalRemainingCorners = remainingCorners[0] + remainingCorners[1];

  if (totalRemainingCorners > 0) {
    const roll = rng.next() * totalRemainingCorners;
    const homeAttack = roll < remainingCorners[0];
    const teamId = homeAttack ? homeTeamId : awayTeamId;
    const minute = chooseQuietMinute(next, maxMinute, rng);
    const squad = homeAttack ? homePlayersAtMinute?.(minute) : awayPlayersAtMinute?.(minute);
    const taker = squad?.length ? pickSetPieceTaker(squad, rng) : undefined;
    const resolution = rng.next() < 0.7 ? 'cleared' : 'retained';
    const context = setPieceContext('corner', rng, resolution)!;
    next.push({
      minute,
      type: 'corner',
      teamId,
      playerId: taker?.uuid,
      playerNumber: taker?.number,
      playerName: taker?.name,
      description: formatDescription(rng.pick(STANDALONE_CORNERS[resolution]), taker?.number, taker?.name),
      playOrigin: 'corner',
      setPiece: context,
    });
  }

  const totalFouls = stats.fouls[0] + stats.fouls[1];
  if (totalFouls >= 16 && rng.next() < 0.62) {
    const homeAttack = rng.next() * totalFouls < stats.fouls[1];
    const teamId = homeAttack ? homeTeamId : awayTeamId;
    const minute = chooseQuietMinute(next, maxMinute, rng);
    const squad = homeAttack ? homePlayersAtMinute?.(minute) : awayPlayersAtMinute?.(minute);
    const taker = squad?.length ? pickSetPieceTaker(squad, rng) : undefined;
    const crossed = rng.next() < 0.58;
    const origin: MatchPlayOrigin = crossed ? 'crossed_free_kick' : 'direct_free_kick';
    const resolution = rng.next() < 0.74 ? 'cleared' : 'retained';
    const context = setPieceContext(origin, rng, resolution)!;
    next.push({
      minute,
      type: 'free_kick',
      teamId,
      playerId: taker?.uuid,
      playerNumber: taker?.number,
      playerName: taker?.name,
      description: formatDescription(rng.pick(STANDALONE_FREE_KICKS[resolution]), taker?.number, taker?.name),
      playOrigin: origin,
      setPiece: context,
    });
  }

  return next.sort((a, b) => a.minute - b.minute);
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
  homePlayersAtMinute?: (minute: number) => Player[],
  awayPlayersAtMinute?: (minute: number) => Player[],
): MatchEvent[] {
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
    const redCardedBefore = new Set(events
      .filter(event => event.type === 'red_card' && event.minute <= ev.minute)
      .map(event => event.playerId)
      .filter((id): id is string => Boolean(id)));
    const defendingSquad = (isHome
      ? awayPlayersAtMinute?.(ev.minute) ?? awaySquad
      : homePlayersAtMinute?.(ev.minute) ?? homeSquad)
      ?.filter(player => !redCardedBefore.has(player.uuid));
    const denyRate = denyRateForTeam(defendingSquad);
    const roll = rng.next();
    if (roll >= denyRate || !defendingSquad?.length) {
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
    // Pick GK or DF for credit. If the preferred position is unavailable,
    // use the other real position rather than relabelling an outfield player.
    const useGk = rng.next() < 0.6;
    const goalkeeper = pickGoalkeeper(defendingSquad);
    const defender = pickDefender(defendingSquad, rng);
    const creditedPlayer = useGk ? goalkeeper ?? defender : defender ?? goalkeeper;
    if (!creditedPlayer) {
      out.push(ev);
      if (consumeAssist) out.push(events[i + 1]);
      i += consumeAssist ? 2 : 1;
      continue;
    }
    const creditType = creditedPlayer.position === 'GK' ? 'gk_save' as const : 'df_block' as const;
    out.push({
      minute: ev.minute,
      type: creditType,
      teamId: isHome ? awayTeamId : homeTeamId,
      playerId: creditedPlayer.uuid,
      playerNumber: creditedPlayer.number,
      playerName: creditedPlayer.name,
      description: creditType === 'gk_save'
        ? rng.pick(GK_SAVE_DESCRIPTIONS)
        : rng.pick(DF_BLOCK_DESCRIPTIONS),
      deniedScorerId: ev.playerId,
      ...(assisterId !== undefined && { deniedAssisterId: assisterId }),
      ...(ev.playOrigin && { playOrigin: ev.playOrigin }),
      ...(ev.setPiece && { setPiece: ev.setPiece }),
    });
    // Advance past the goal (and assist, if consumed).
    i += consumeAssist ? 2 : 1;
  }
  return out;
}
