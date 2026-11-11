import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from './ui';
import {
  buildAwardBuzz,
  type AwardBuzzCard,
  type BuzzCandidate,
  type BuzzTier,
} from '../engine/awards/award-buzz';
import type { GameWorld } from '../engine/season/season-manager';
import type { RecentPlayerForm } from '../engine/players/star-presence';
import type { PlayerPosition } from '../types/player';

interface AwardBuzzPanelProps {
  world: GameWorld;
  /** Precomputed by the player centre so completed matches are not scored twice. */
  recentForms: Map<string, RecentPlayerForm>;
}

const TIER_ORDER: readonly BuzzTier[] = ['frontrunner', 'contender', 'outsider'];

const TIER_LABELS: Record<BuzzTier, string> = {
  frontrunner: '最被看好',
  contender: '有力竞争',
  outsider: '黑马',
};

const POSITION_COLORS: Record<PlayerPosition, string> = {
  GK: 'text-amber-400',
  DF: 'text-blue-400',
  MF: 'text-green-400',
  FW: 'text-red-400',
};

/**
 * "Who is in the running" panel for the season's individual awards.
 *
 * Deliberately shows bands, not a ranking, and no buzz score. The candidate
 * list is a mid-season projection built from a different formula than the
 * award itself, so the frontrunner is not a prediction the player can rely on —
 * the award's largest input, final league position, is still unknown here.
 */
export default function AwardBuzzPanel({ world, recentForms }: AwardBuzzPanelProps) {
  const buzz = useMemo(
    () => buildAwardBuzz(world, { recentForms }),
    [world, recentForms],
  );

  if (!buzz) return null;

  return (
    <section aria-labelledby="award-buzz-heading" className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="award-buzz-heading" className="text-sm font-semibold text-slate-100">
            奖项风向
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            第 {buzz.asOfRound} 轮形势 · 剩余 {buzz.roundsRemaining} 轮
          </p>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        这是赛季后半段的<b className="font-semibold text-slate-400">形势</b>，不是最终结果，也不是评奖排名。
        风向综合了赛季表现、近期状态与球队势头，与最终评奖口径并不相同；最终结果取决于剩余轮次的表现
        与赛季最终联赛排名。同一球员同赛季只取一个奖项。
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {buzz.cards.map(card => (
          <BuzzCard key={card.award} card={card} />
        ))}
      </div>
    </section>
  );
}

function BuzzCard({ card }: { card: AwardBuzzCard }) {
  const grouped = useMemo(() => {
    const map = new Map<BuzzTier, BuzzCandidate[]>();
    for (const tier of TIER_ORDER) map.set(tier, []);
    for (const candidate of card.candidates) {
      map.get(candidate.tier)?.push(candidate);
    }
    return map;
  }, [card.candidates]);

  return (
    <Panel padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true">{card.emoji}</span>
          <span className={`truncate text-sm font-semibold ${card.color}`}>{card.label}</span>
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            card.mood === 'runaway'
              ? 'bg-amber-500/12 text-amber-300'
              : 'bg-slate-700/40 text-slate-400'
          }`}
        >
          {card.mood === 'runaway' ? '一人领跑' : '胶着'}
        </span>
      </div>

      <div>
        {TIER_ORDER.map(tier => {
          const group = grouped.get(tier) ?? [];
          if (group.length === 0) return null;
          return (
            <div key={tier}>
              <div className="border-t border-slate-700/40 bg-slate-900/30 px-3 py-1 text-[10px] font-medium text-slate-500">
                {TIER_LABELS[tier]}
              </div>
              {group.map(candidate => (
                <CandidateRow key={candidate.playerId} candidate={candidate} />
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function CandidateRow({ candidate }: { candidate: BuzzCandidate }) {
  const context = [candidate.honours, candidate.form].filter(Boolean).join(' · ');
  const standing = candidate.teamPosition > 0 ? ` 当前第${candidate.teamPosition}名` : '';

  return (
    <Link
      to={`/player/${candidate.playerId}`}
      className="block border-t border-slate-700/30 px-3 py-2 transition-colors hover:bg-slate-800/60"
    >
      <span className="flex items-center gap-2">
        <span className={`shrink-0 text-[10px] font-semibold ${POSITION_COLORS[candidate.position]}`}>
          {candidate.position}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
          {candidate.playerName}
        </span>
        <span className="shrink-0 truncate text-[11px] text-slate-400">
          {candidate.teamShortName}{standing}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-slate-400">{candidate.line}</span>
      {context && (
        <span className="mt-0.5 block truncate text-[10px] text-slate-500">{context}</span>
      )}
    </Link>
  );
}
