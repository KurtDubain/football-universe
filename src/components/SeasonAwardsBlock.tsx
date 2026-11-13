import { Link } from 'react-router-dom';
import { AWARD_META } from '../engine/awards/season-awards';
import type { PlayerAward } from '../types/award';

/**
 * 归档提示文案。
 *
 * `playerAwardsHistory` 按 `PLAYER_AWARDS_SEASONS`（src/engine/season/storage-limits.ts，当前 50）
 * 逐赛季裁剪，窗口外的赛季奖项已被丢弃且无法回溯。这是容量策略的正常结果，
 * 不是数据错误，所以文案与配色都刻意保持低调。
 */
export const AWARDS_ARCHIVED_HINT = '球员记录已归档（仅保留最近 50 季）';

/** 射手王展示所需的最小字段，由 chronicle-awards 的读取层组装。 */
export interface SeasonTopScorerView {
  playerId: string;
  playerName: string;
  teamName: string;
  teamColor?: string;
  /** 联赛口径说明，来自 `seasonTopScorerLabel`，含赛程折算推导，不写死。 */
  label: string;
}

export interface SeasonAwardsBlockProps {
  /** 该赛季已颁出的奖项，按展示优先级排好序。 */
  awards: PlayerAward[];
  /** 该赛季奖项已被容量裁剪：只显示归档提示，绝不渲染空区块。 */
  archived: boolean;
  topScorer: SeasonTopScorerView | null;
}

/**
 * 编年史赛季条目的「颁奖典礼 + 赛季射手王」区块。
 *
 * 纯展示组件：归档判定与数据读取都在 src/pages/chronicle-awards.ts，
 * 这里只负责把三种状态（已颁奖 / 已归档 / 窗口内无记录）表达成不同 UI。
 */
export default function SeasonAwardsBlock({ awards, archived, topScorer }: SeasonAwardsBlockProps) {
  if (archived) {
    return (
      <div
        data-testid="season-awards-archived"
        className="rounded-lg border border-dashed border-slate-700/50 px-3 py-2 text-[11px] text-slate-600"
      >
        {AWARDS_ARCHIVED_HINT}
      </div>
    );
  }

  // 窗口内但确实没有奖项记录（例如存档异常）：静默不渲染，与「已归档」区分开。
  if (awards.length === 0 && !topScorer) return null;

  return (
    <div
      data-testid="season-awards-block"
      className="bg-amber-900/15 rounded-lg border border-amber-700/30 p-4"
    >
      {awards.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">🏆 颁奖典礼</h3>
          <div data-testid="season-awards-grid" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {awards.map(award => {
              const meta = AWARD_META[award.type];
              return (
                <Link
                  key={award.type}
                  to={`/player/${award.playerId}`}
                  data-testid={`season-award-${award.type}`}
                  className="bg-slate-900/40 rounded-lg border border-slate-700/40 p-2.5 hover:border-amber-600/50 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{meta.emoji}</span>
                    <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-100 truncate" title={award.playerName}>
                    {award.playerName}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate" title={award.teamName}>
                    {award.teamName}
                  </div>
                  <div className={`text-[10px] mt-0.5 font-semibold ${meta.color}`}>{award.statLabel}</div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {topScorer && (
        <div
          data-testid="season-top-scorer"
          className={awards.length > 0 ? 'mt-3 pt-3 border-t border-amber-700/20' : ''}
        >
          <div className="text-[10px] text-amber-400 font-semibold mb-1">赛季射手王</div>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: topScorer.teamColor ?? '#666' }}
            />
            <Link
              to={`/player/${topScorer.playerId}`}
              className="text-xs font-semibold text-slate-100 hover:text-blue-400"
              title={topScorer.playerName}
            >
              {topScorer.playerName}
            </Link>
            <span className="text-[10px] text-slate-400 truncate" title={topScorer.teamName}>
              {topScorer.teamName}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">{topScorer.label}</div>
        </div>
      )}
    </div>
  );
}
