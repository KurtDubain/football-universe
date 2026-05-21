import { GameWorld, NewsItem } from '../season/season-manager';
import { Player, PlayerPosition } from '../../types/player';
import { SeededRNG } from '../match/rng';
import { createNewsId } from '../season/helpers';

/**
 * Phase 转会传闻 — generated in the back-end of each season as "rumors"
 * that may or may not turn into actual transfers.
 *
 * Each rumor: an elite team (overall ≥ 82) is "interested in" a top
 * candidate from a non-elite team. Persisted in `world.transferRumors`
 * until the season-end transfer window fires (which clears them).
 *
 * Intentionally loose coupling: rumors don't force the actual transfer.
 * The transfer-window pipeline runs independently, so some rumors
 * turn out true and others are "false". Creates anticipation between
 * matches without over-constraining the engine.
 */

const ELITE_OVERALL_THRESHOLD = 82;
const NON_ELITE_OVERALL_THRESHOLD = 80;
const RUMOR_TRIGGER_WINDOW_FROM_END = 10;  // start generating rumors 10 windows before season end
const RUMORS_PER_BATCH = 3;                // per trigger window

export interface TransferRumor {
  id: string;
  season: number;
  windowIndex: number;
  candidateUuid: string;
  candidateName: string;
  candidatePosition: PlayerPosition;
  fromTeamId: string;
  fromTeamName: string;
  eliteTeamId: string;
  eliteTeamName: string;
  /** Visual emphasis — based on candidate rating tier. */
  intensity: 'low' | 'medium' | 'high';
}

/**
 * Should we generate a rumor batch this window? Trigger every 3 windows
 * within the final RUMOR_TRIGGER_WINDOW_FROM_END windows of the season.
 */
export function shouldGenerateRumors(world: GameWorld): boolean {
  const idx = world.seasonState.currentWindowIndex;
  const total = world.seasonState.calendar.length;
  const windowsRemaining = total - idx;
  if (windowsRemaining > RUMOR_TRIGGER_WINDOW_FROM_END || windowsRemaining <= 1) return false;
  // Fire every 3 windows (creates 3-4 batches per season's rumor period)
  return idx % 3 === 0;
}

/**
 * Generate a batch of transfer rumors. Returns the new rumors + news
 * items to push. Stored as a transient array on world; cleared by the
 * season-end transfer pipeline.
 */
export function generateRumors(world: GameWorld, rng: SeededRNG): { rumors: TransferRumor[]; news: NewsItem[] } {
  const rumors: TransferRumor[] = [];
  const news: NewsItem[] = [];

  const eliteTeams = Object.values(world.teamBases).filter(t => t.overall >= ELITE_OVERALL_THRESHOLD);
  if (eliteTeams.length === 0) return { rumors, news };

  // Build candidate pool: top stat-producers from non-elite teams
  type Cand = { player: Player; teamId: string; teamName: string; sortKey: number };
  const candPool: Cand[] = [];
  for (const stat of Object.values(world.playerStats)) {
    const team = world.teamBases[stat.teamId];
    if (!team || team.overall >= NON_ELITE_OVERALL_THRESHOLD) continue;
    const player = (world.squads[stat.teamId] ?? []).find(p => p.uuid === stat.playerId);
    if (!player) continue;
    if (player.tag === 'loyal') continue; // loyal won't be poached, no rumors
    let sortKey = 0;
    switch (player.position) {
      case 'FW': sortKey = stat.goals * 3; break;
      case 'MF': sortKey = stat.goals * 2 + stat.assists * 2; break;
      case 'DF': case 'GK': sortKey = stat.appearances * (player.rating / 100); break;
    }
    if (sortKey < 3) continue;
    candPool.push({ player, teamId: stat.teamId, teamName: team.name, sortKey });
  }
  if (candPool.length === 0) return { rumors, news };
  candPool.sort((a, b) => b.sortKey - a.sortKey);

  // Take top 8 as pool, shuffle, take first N for this batch
  const shortlist = rng.shuffle(candPool.slice(0, 8));
  const season = world.seasonState.seasonNumber;
  const windowIndex = world.seasonState.currentWindowIndex;
  const existing = world.transferRumors ?? [];
  const alreadyRumored = new Set(existing.map(r => `${r.candidateUuid}|${r.eliteTeamId}`));

  for (const cand of shortlist) {
    if (rumors.length >= RUMORS_PER_BATCH) break;
    // Pick a random elite that isn't the candidate's own team
    const elite = rng.pick(eliteTeams.filter(t => t.id !== cand.teamId));
    if (!elite) continue;
    const key = `${cand.player.uuid}|${elite.id}`;
    if (alreadyRumored.has(key)) continue; // already rumored this season
    alreadyRumored.add(key);

    const intensity: TransferRumor['intensity'] =
      cand.player.rating >= 85 ? 'high' :
      cand.player.rating >= 75 ? 'medium' :
      'low';

    const rumor: TransferRumor = {
      id: `rumor-${season}-${windowIndex}-${cand.player.uuid}-${elite.id}`,
      season, windowIndex,
      candidateUuid: cand.player.uuid,
      candidateName: cand.player.name ?? `${cand.player.number}号`,
      candidatePosition: cand.player.position,
      fromTeamId: cand.teamId,
      fromTeamName: cand.teamName,
      eliteTeamId: elite.id,
      eliteTeamName: elite.name,
      intensity,
    };
    rumors.push(rumor);

    const intensityLabel = intensity === 'high' ? '紧锣密鼓' : intensity === 'medium' ? '深入接触' : '初步关注';
    news.push({
      id: createNewsId(season, windowIndex, `rumor-${cand.player.uuid}-${elite.id}`),
      seasonNumber: season,
      windowIndex,
      type: 'rumor',
      title: `📢 ${elite.name} ${intensityLabel} ${cand.player.name ?? cand.player.number}`,
      description: `据可靠消息，${elite.name}近日对${cand.teamName}的${cand.player.name}（${cand.player.position}）表现出${intensityLabel}的兴趣。`,
    });
  }

  return { rumors, news };
}
