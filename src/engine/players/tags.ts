import { Player, PlayerPosition, PlayerTag, StyleTag } from '../../types/player';

/**
 * v23 — personality and playing-style tags.
 *
 * Two independent layers, both rolled from a deterministic hash of the uuid:
 *
 *   personality (0-2)  who the player IS — transfers, injuries, market value,
 *                      discipline, and the two that reach the shot weights
 *   style       (0-1)  HOW the player produces — the axis the match engine
 *                      divides a fixed pool of events along
 *
 * Why uuid-hash (vs RNG): tags are immutable destiny. A uuid hash makes the
 * assignment reproducible — the same save reloaded yields identical tags, and a
 * youth graduate's tags are decided the moment their uuid is minted.
 *
 * ── What a style can and cannot do ────────────────────────────────────
 *
 * A style is a multiplier on a weight the engine ALREADY computes. The pool of
 * goals, assists, cards and defensive actions is fixed by the fixture before any
 * tag is consulted, so a style can only move who receives them. It never touches
 * `peakRating`: a 55-rated midfield engine does not become a 70-rated one, he
 * just converts the same ability into interceptions instead of assists.
 *
 * That is the whole design intent — richer output structure, not a second
 * ability axis — and it is why the style table is per-position: a forward has
 * two dials (finishing, creation) and a keeper has exactly one.
 */

/** FNV-1a, salted so independent slots hash independently. */
function fnv1a(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ── Personality roll ────────────────────────────────────────────────

/**
 * Relative weight of each personality tag, summing to 100. Slot hit rates are
 * applied on top (see SLOT_HIT_RATES), so these decide the mix WITHIN a slot,
 * not how often a player is tagged at all.
 */
const TAG_WEIGHTS: ReadonlyArray<readonly [PlayerTag, number]> = [
  ['loyal', 12],
  ['ambitious', 12],
  ['iron', 8],
  ['glass', 8],
  ['clutch', 10],
  ['late_bloomer', 8],
  ['wanderer', 10],
  ['hothead', 8],
  ['gentleman', 6],
  ['solo', 6],
  ['leader', 6],
  ['early_peak', 6],
];

/**
 * Independent hit rate per slot. 0.50 / 0.42 solves to 29% untagged, 50% with
 * one and 21% with two — the two-tag rate is capped at (p1+p2)²/4, so pushing
 * either slot higher trades untagged players away one-for-one rather than
 * adding a third tag.
 */
const SLOT_HIT_RATES = [0.50, 0.42] as const;

/** Pairs that must never land on the same player. */
const TAG_MUTEX: ReadonlyArray<readonly [PlayerTag, PlayerTag]> = [
  ['loyal', 'wanderer'],
  ['loyal', 'ambitious'],
  ['iron', 'glass'],
  ['late_bloomer', 'early_peak'],
  ['hothead', 'gentleman'],
];

function mutexWith(a: PlayerTag, b: PlayerTag): boolean {
  return TAG_MUTEX.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function tagAt(bucket: number, hitRate: number): PlayerTag | undefined {
  if (bucket >= hitRate * 100) return undefined;
  const scaled = (bucket / (hitRate * 100)) * 100;
  let acc = 0;
  for (const [tag, weight] of TAG_WEIGHTS) {
    acc += weight;
    if (scaled < acc) return tag;
  }
  return TAG_WEIGHTS[TAG_WEIGHTS.length - 1][0];
}

/**
 * Roll 0-2 personality tags for a uuid.
 *
 * Slot 2 is re-rolled once on a mutex collision rather than dropped, so the
 * measured two-tag rate stays at the nominal 21% instead of leaking a few
 * points every time an incompatible pair comes up.
 */
export function rollTagsForUuid(uuid: string): PlayerTag[] {
  const tags: PlayerTag[] = [];
  const first = tagAt(fnv1a(uuid) % 100, SLOT_HIT_RATES[0]);
  if (first) tags.push(first);

  const slot2Base = fnv1a(`${uuid}#tags2`) % 100;
  let second = tagAt(slot2Base, SLOT_HIT_RATES[1]);
  if (first && second && mutexWith(first, second)) {
    second = tagAt(fnv1a(`${uuid}#tags2r`) % 100, SLOT_HIT_RATES[1]);
    if (second && mutexWith(first, second)) second = undefined;
  }
  if (second && second !== first) tags.push(second);
  return tags;
}

// ── Style roll ──────────────────────────────────────────────────────

/**
 * Per-position style table, summing to 100 at each position.
 *
 * The undefined entry is the conventional player and is deliberately large:
 * without a baseline group there is nothing to measure a style's effect
 * against, and every position would drift at once.
 */
const STYLE_TABLE: Record<PlayerPosition, ReadonlyArray<readonly [StyleTag | undefined, number]>> = {
  FW: [['poacher', 45], ['creator', 35], [undefined, 20]],
  MF: [['playmaker', 30], ['engine', 30], ['shadow', 20], [undefined, 20]],
  DF: [['marker', 35], ['sweeper', 35], ['raider_df', 15], [undefined, 15]],
  GK: [['shotstopper', 40], ['flaky', 25], [undefined, 35]],
};

/** Roll the one style available at this position, or undefined. */
export function rollStyleTagForUuid(uuid: string, position: PlayerPosition): StyleTag | undefined {
  const bucket = fnv1a(`${uuid}#style`) % 100;
  let acc = 0;
  for (const [style, weight] of STYLE_TABLE[position]) {
    acc += weight;
    if (bucket < acc) return style;
  }
  return undefined;
}

// ── Reading tags off a player ───────────────────────────────────────

type TaggedPlayer = Pick<Player, 'tags' | 'tag'>;

/**
 * The player's personality tags, folding the legacy single-tag shape in.
 *
 * Every consumer must go through this. Reading `player.tag` directly returns
 * undefined for every player generated after v23 and silently drops the effect.
 */
export function getPlayerTags(player: TaggedPlayer | undefined): PlayerTag[] {
  if (!player) return [];
  if (player.tags && player.tags.length > 0) return player.tags;
  return player.tag ? [player.tag] : [];
}

/**
 * Peak-age band implied by the personality tags, or undefined for the default
 * 24-29 spread. `late_bloomer` and `early_peak` are mutually exclusive so at
 * most one can apply.
 */
export function peakAgeBandForTags(tags: readonly PlayerTag[]): readonly [number, number] | undefined {
  if (tags.includes('late_bloomer')) return [28, 32];
  if (tags.includes('early_peak')) return [21, 24];
  return undefined;
}

export function hasTag(player: TaggedPlayer | undefined, tag: PlayerTag): boolean {
  const tags = getPlayerTags(player);
  for (const owned of tags) if (owned === tag) return true;
  return false;
}

// ── Effects ─────────────────────────────────────────────────────────

/**
 * The axes a style can move. `defense` applies to both interception and
 * clearance weights; `interception` / `clearance` refine that split and
 * compose multiplicatively with it.
 */
export type StyleAxis = 'goal' | 'assist' | 'defense' | 'interception' | 'clearance' | 'keeperCredit';

/**
 * Style multipliers, calibrated against measured output rather than chosen for
 * round numbers.
 *
 * Every one of these is a weight multiplier inside a SHARE, so the realised
 * effect is always smaller than the number and shrinks as the position's base
 * weight grows — a forward already takes most of his team's shots, so ×1.55 on
 * him lands near ×1.11 while the same number on a midfielder lands near ×1.5.
 * The numbers below are set so the MEASURED per-90 ratios separate the
 * archetypes, which is why the forward's pair is the widest in the table.
 */
const STYLE_EFFECTS: Record<StyleTag, Partial<Record<StyleAxis, number>>> = {
  poacher:     { goal: 1.55, assist: 0.40 },
  creator:     { goal: 0.60, assist: 1.95 },
  playmaker:   { assist: 1.90, defense: 0.50 },
  engine:      { assist: 0.55, goal: 0.85, defense: 1.60 },
  shadow:      { goal: 2.20, defense: 0.60 },
  marker:      { interception: 1.55, clearance: 0.70 },
  sweeper:     { interception: 0.70, clearance: 1.55 },
  raider_df:   { goal: 4.00 },
  shotstopper: { keeperCredit: 1.30 },
  flaky:       {}, // resolved per match, see keeperCreditChance
};

export function styleWeight(style: StyleTag | undefined, axis: StyleAxis): number {
  if (!style) return 1;
  return STYLE_EFFECTS[style][axis] ?? 1;
}

/** The axes a personality tag can move inside the match engine. */
export type PersonalityAxis = 'goal' | 'assist' | 'card';

/** Personality multipliers on the engine's share-based axes. */
const PERSONALITY_EFFECTS: Partial<Record<PlayerTag, Partial<Record<PersonalityAxis, number>>>> = {
  solo:      { goal: 1.25, assist: 0.45 },
  gentleman: { card: 0.20 },
};

/**
 * Chance per match that a hothead picks up a booking ON TOP of his share of the
 * match's normal card count.
 *
 * `hothead` is deliberately absent from PERSONALITY_EFFECTS above. A share
 * multiplier cannot express him: card share saturates upward so hard that ×3.5
 * measured ×1.14 on a defender, while the mirror-image `gentleman` at ×0.20
 * measured ×0.43 because downward shifts stay near-linear. An extra booking is
 * outside the share entirely, so it reads the same at every position.
 */
export const HOTHEAD_EXTRA_BOOKING_CHANCE = 0.35;

/** Multiplier from personality tags on one engine axis. Tags compose. */
export function personalityWeight(player: TaggedPlayer | undefined, axis: PersonalityAxis): number {
  let weight = 1;
  for (const tag of getPlayerTags(player)) {
    weight *= PERSONALITY_EFFECTS[tag]?.[axis] ?? 1;
  }
  return weight;
}

/**
 * Market-value multiplier from personality tags. glass ×0.7 (clubs discount a
 * player they expect to lose), leader ×1.10 (a captain is worth more than his
 * legs). Composes, so a glass leader is 0.77 rather than either alone.
 */
export function tagMarketMultiplier(player: TaggedPlayer | undefined): number {
  let mul = 1;
  if (hasTag(player, 'glass')) mul *= 0.7;
  if (hasTag(player, 'leader')) mul *= 1.10;
  return mul;
}

/** Injury-chance multiplier. iron ÷3, glass ×2. */
export function tagInjuryMultiplier(player: TaggedPlayer | undefined): number {
  let mul = 1;
  if (hasTag(player, 'iron')) mul /= 3;
  if (hasTag(player, 'glass')) mul *= 2;
  return mul;
}

/** Poach-probability multiplier. leader ×0.6, ambitious +0.12 flat (see caller). */
export function tagPoachMultiplier(player: TaggedPlayer | undefined): number {
  return hasTag(player, 'leader') ? 0.6 : 1;
}

/** Big-match goal multiplier. Kept separate because it is conditional. */
export function clutchGoalWeight(player: TaggedPlayer | undefined, isBigMatch: boolean): number {
  return isBigMatch && hasTag(player, 'clutch') ? 1.3 : 1;
}

// ── Keeper credit ───────────────────────────────────────────────────

/** Baseline share of denied goals credited to the keeper rather than a defender. */
export const KEEPER_CREDIT_BASE = 0.60;
/**
 * The two states a flaky keeper flips between, redrawn every match.
 *
 * Symmetric around KEEPER_CREDIT_BASE on purpose. An earlier asymmetric pair
 * (0.45 / 0.78) measured a full point of save percentage BELOW a conventional
 * keeper: a low credit share pushes denials onto defenders, and those do not
 * count in the keeper's shots faced, so the downside state costs more than the
 * upside state gains. A flaky keeper should be volatile, not worse.
 */
export const FLAKY_KEEPER_CREDIT = [0.48, 0.72] as const;

/**
 * Share of this match's denied goals that go to the keeper.
 *
 * `roll` is consumed by the CALLER and only for a flaky keeper — every other
 * style is a pure function of the tag. That is deliberate: if a future style
 * needed its own roll, matches without that style would still consume an extra
 * RNG draw and the whole world line would shift for everyone.
 */
export function keeperCreditChance(
  player: (TaggedPlayer & { styleTag?: StyleTag }) | undefined,
  roll: number = 0,
): number {
  const style = player?.styleTag;
  if (style === 'flaky') return FLAKY_KEEPER_CREDIT[roll < 0.5 ? 0 : 1];
  return KEEPER_CREDIT_BASE * styleWeight(style, 'keeperCredit');
}

// ── Display ─────────────────────────────────────────────────────────

/** Display label + color class. Used by PlayerDetail. */
export const TAG_META: Record<PlayerTag, { label: string; icon: string; color: string }> = {
  loyal:        { label: '忠诚',     icon: '🛡️', color: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  ambitious:    { label: '野心家',   icon: '🚀', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  iron:         { label: '铁人',     icon: '💪', color: 'bg-slate-700/60 text-slate-300 border-slate-600/40' },
  glass:        { label: '玻璃人',   icon: '🩹', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
  clutch:       { label: '大心脏',   icon: '❤️‍🔥', color: 'bg-rose-900/40 text-rose-300 border-rose-700/40' },
  late_bloomer: { label: '大器晚成', icon: '🌾', color: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  wanderer:     { label: '浪子',     icon: '🎒', color: 'bg-violet-900/40 text-violet-300 border-violet-700/40' },
  hothead:      { label: '火药桶',   icon: '🧨', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
  gentleman:    { label: '干净利落', icon: '🕊️', color: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
  solo:         { label: '独狼',     icon: '🐺', color: 'bg-zinc-700/60 text-zinc-300 border-zinc-600/40' },
  leader:       { label: '领袖',     icon: '🎖️', color: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  early_peak:   { label: '少年老成', icon: '⚡', color: 'bg-teal-900/40 text-teal-300 border-teal-700/40' },
};

export const STYLE_TAG_META: Record<StyleTag, { label: string; icon: string; color: string }> = {
  poacher:     { label: '禁区猎手', icon: '🎯', color: 'bg-red-900/40 text-red-300 border-red-700/40' },
  creator:     { label: '机会制造者', icon: '🪄', color: 'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-700/40' },
  playmaker:   { label: '组织核心', icon: '🧠', color: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40' },
  engine:      { label: '工兵',     icon: '⚙️', color: 'bg-stone-700/60 text-stone-300 border-stone-600/40' },
  shadow:      { label: '影子前锋', icon: '👤', color: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  marker:      { label: '盯人中卫', icon: '🔒', color: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  sweeper:     { label: '清道夫',   icon: '🧹', color: 'bg-sky-900/40 text-sky-300 border-sky-700/40' },
  raider_df:   { label: '带刀后卫', icon: '🗡️', color: 'bg-rose-900/40 text-rose-300 border-rose-700/40' },
  shotstopper: { label: '门线型',   icon: '🧤', color: 'bg-lime-900/40 text-lime-300 border-lime-700/40' },
  flaky:       { label: '神经刀',   icon: '🎲', color: 'bg-purple-900/40 text-purple-300 border-purple-700/40' },
};
