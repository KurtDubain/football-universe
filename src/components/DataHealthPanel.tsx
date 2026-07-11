import { useMemo } from 'react';
import type { GameWorld } from '../engine/season/season-manager';
import { validateWorldData } from '../engine/validation/world-data';

export default function DataHealthPanel({ world }: { world: GameWorld }) {
  const result = useMemo(() => validateWorldData(world), [world]);
  const clean = result.issues.length === 0;
  const statusTone = result.errors.length > 0
    ? 'text-red-300'
    : result.warnings.length > 0
      ? 'text-amber-300'
      : 'text-emerald-300';

  return (
    <section className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">数据健康</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">仅开发环境 · 当前世界快照</p>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className={statusTone}>{clean ? '正常' : '需检查'}</span>
          <span className="text-red-300">错误 {result.errors.length}</span>
          <span className="text-amber-300">警告 {result.warnings.length}</span>
        </div>
      </div>
      {!clean && (
        <details className="border-t border-slate-700/60">
          <summary className="px-4 py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
            查看问题明细 ({result.issues.length})
          </summary>
          <div className="max-h-72 overflow-y-auto border-t border-slate-700/40 divide-y divide-slate-700/30">
            {result.issues.slice(0, 100).map((issue, index) => (
              <div key={`${issue.code}-${issue.playerId ?? issue.teamId ?? issue.fixtureId ?? index}`} className="px-4 py-2 text-[11px]">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>
                    {issue.severity === 'error' ? '错误' : '警告'}
                  </span>
                  <code className="text-slate-400">{issue.code}</code>
                </div>
                <p className="text-slate-500 break-words">{issue.message}</p>
              </div>
            ))}
            {result.issues.length > 100 && (
              <p className="px-4 py-2 text-[10px] text-slate-600">仅显示前 100 条问题。</p>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
