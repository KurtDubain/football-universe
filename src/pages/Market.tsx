import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/game-store';
import { formatMoney } from '../engine/economy/finance';
import { Icon } from '../components/Icon';

/**
 * Phase 2 — Transfer Window page for favorite teams.
 *
 * Surface only when `world.transferWindow` is open. Shows:
 *   - Incoming offers (elite teams bidding for YOUR stars)
 *   - Outgoing targets (rumored players you could bid for)
 *   - Free agent pool (sign for €5M each)
 * Plus action buttons. "完成" closes the window + advances to next season.
 *
 * Auto-redirects to / if no window is open.
 */
const POS_LABEL: Record<string, string> = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };
const POS_COLOR: Record<string, string> = {
  GK: 'bg-amber-900/40 text-amber-300',
  DF: 'bg-blue-900/40 text-blue-300',
  MF: 'bg-emerald-900/40 text-emerald-300',
  FW: 'bg-red-900/40 text-red-300',
};

export default function Market() {
  const world = useGameStore((s) => s.world);
  const favoriteTeamIds = useGameStore((s) => s.favoriteTeamIds);
  const acceptIncomingOffer = useGameStore((s) => s.acceptIncomingOffer);
  const rejectIncomingOffer = useGameStore((s) => s.rejectIncomingOffer);
  const counterIncomingOffer = useGameStore((s) => s.counterIncomingOffer);
  const bidForOutgoingTarget = useGameStore((s) => s.bidForOutgoingTarget);
  const signFromFreeAgentPool = useGameStore((s) => s.signFromFreeAgentPool);
  const closeTransferWindow = useGameStore((s) => s.closeTransferWindow);
  const navigate = useNavigate();
  const [bidValues, setBidValues] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!world?.transferWindow) {
      navigate('/');
    }
  }, [world?.transferWindow, navigate]);

  if (!world || !world.transferWindow) return null;
  const tw = world.transferWindow;
  const favTeamFinances = favoriteTeamIds[0] ? world.teamFinances[favoriteTeamIds[0]] : undefined;
  const pendingOffers = tw.incomingOffers.filter(o => o.resolution === 'pending');
  const resolvedOffers = tw.incomingOffers.filter(o => o.resolution !== 'pending');
  const pendingTargets = tw.outgoingTargets.filter(t => t.resolution === 'pending');
  const resolvedTargets = tw.outgoingTargets.filter(t => t.resolution !== 'pending');
  const poolPlayers = (world.freeAgentPool ?? []).filter(p =>
    tw.freeAgentUuids.includes(p.uuid) && !tw.signedFromPool.includes(p.uuid)
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-900/30 to-slate-800/60 rounded-xl border border-amber-700/40 p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-amber-300 inline-flex items-center gap-2"><Icon name="stadium" size={26} accent="#fbbf24" /> 转会窗口 S{tw.season}</h1>
            <p className="text-xs text-slate-400 mt-1">仅你的收藏球队需要决策,其他球队已自动处理</p>
          </div>
          {favTeamFinances && (
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-300">{formatMoney(favTeamFinances.cash)}</div>
              <div className="text-[10px] text-slate-500">现金</div>
            </div>
          )}
        </div>
      </div>

      {/* Incoming offers */}
      <Section title={<><Icon name="inbox" size={14} className="inline-block mr-1" /> 收到的报价 ({pendingOffers.length})</>} emptyMessage={tw.incomingOffers.length === 0 ? '本赛季无人向你的球队报价' : undefined}>
        {pendingOffers.map(o => (
          <div key={o.id} className="bg-slate-800 rounded-lg border border-slate-700/60 p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${POS_COLOR[o.playerPosition] ?? ''}`}>{POS_LABEL[o.playerPosition]}</span>
              <span className="text-sm font-semibold text-slate-100">{o.playerName}</span>
              <span className="text-[10px] text-slate-500">能力 {o.playerRating}</span>
              <span className="text-[10px] text-slate-500">从 {o.ownerTeamName}</span>
              <span className="text-amber-300 font-bold ml-auto">{formatMoney(o.fee)}</span>
            </div>
            <div className="text-xs text-slate-400 mb-2">
              <span className="font-medium text-slate-300">{o.buyerName}</span> 出价求购
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => acceptIncomingOffer(o.id)} className="text-xs px-3 py-2 sm:py-1.5 min-h-[36px] bg-emerald-700 hover:bg-emerald-600 rounded text-white inline-flex items-center gap-1"><Icon name="check" size={12} /> 接受 {formatMoney(o.fee)}</button>
              <button onClick={() => counterIncomingOffer(o.id)} className="text-xs px-3 py-2 sm:py-1.5 min-h-[36px] bg-amber-700 hover:bg-amber-600 rounded text-white inline-flex items-center gap-1"><Icon name="speech" size={12} /> 还价 {formatMoney(Math.round(o.fee * 1.3))} (60%成功率)</button>
              <button onClick={() => rejectIncomingOffer(o.id)} className="text-xs px-3 py-2 sm:py-1.5 min-h-[36px] bg-red-800 hover:bg-red-700 rounded text-white inline-flex items-center gap-1"><Icon name="x" size={12} /> 拒绝</button>
            </div>
          </div>
        ))}
        {resolvedOffers.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] text-slate-500">已处理 {resolvedOffers.length}:</div>
            {resolvedOffers.map(o => (
              <div key={o.id} className="text-xs text-slate-500 flex items-center gap-2">
                <span>{o.playerName}</span>
                <span className="text-slate-600">{o.buyerName} {formatMoney(o.counterFee ?? o.fee)}</span>
                <span className="ml-auto">{resolutionLabel(o.resolution)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Outgoing targets */}
      <Section title={<><Icon name="target" size={14} className="inline-block mr-1" /> 你的目标 ({pendingTargets.length})</>} emptyMessage={tw.outgoingTargets.length === 0 ? '无可用候选(本赛季没有合适的明星)' : undefined}>
        {pendingTargets.map(t => {
          const currentBid = bidValues[t.id] ?? t.suggestedFee;
          const canAfford = favTeamFinances && favTeamFinances.cash >= currentBid;
          return (
            <div key={t.id} className="bg-slate-800 rounded-lg border border-slate-700/60 p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${POS_COLOR[t.playerPosition] ?? ''}`}>{POS_LABEL[t.playerPosition]}</span>
                <span className="text-sm font-semibold text-slate-100">{t.playerName}</span>
                <span className="text-[10px] text-slate-500">能力 {t.playerRating}</span>
                <span className="text-[10px] text-slate-500">来自 {t.fromTeamName}</span>
                <span className="text-slate-300 ml-auto">建议 {formatMoney(t.suggestedFee)}</span>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="flex items-center gap-1 flex-1 min-w-0 sm:flex-none">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={currentBid}
                    onChange={e => setBidValues({ ...bidValues, [t.id]: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="text-sm sm:text-xs px-2 py-2 sm:py-1 w-full sm:w-24 min-w-0 bg-slate-900 border border-slate-700 rounded text-slate-200"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">M €</span>
                </div>
                <button
                  onClick={() => bidForOutgoingTarget(t.id, currentBid)}
                  disabled={!canAfford}
                  className="text-xs px-3 py-2 sm:py-1.5 min-h-[36px] bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-500 rounded text-white"
                >
                  <Icon name="outbox" size={12} className="inline-block mr-1" /> 报价
                </button>
                <span className="text-[10px] text-slate-500 sm:ml-auto basis-full sm:basis-auto">出价 ≥ {formatMoney(Math.round(t.suggestedFee * 0.9))} 接受概率高</span>
              </div>
              {!canAfford && (
                <div className="text-[10px] text-red-400 mt-1">💸 现金不足</div>
              )}
            </div>
          );
        })}
        {resolvedTargets.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[10px] text-slate-500">已处理 {resolvedTargets.length}:</div>
            {resolvedTargets.map(t => (
              <div key={t.id} className="text-xs text-slate-500 flex items-center gap-2">
                <span>{t.playerName}</span>
                <span className="text-slate-600">{t.fromTeamName} → 你 {t.bidFee ? formatMoney(t.bidFee) : ''}</span>
                <span className="ml-auto">{resolutionLabel(t.resolution)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Free agent pool */}
      <Section title={<><Icon name="cart" size={14} className="inline-block mr-1" /> 自由市场 ({poolPlayers.length})</>} emptyMessage={poolPlayers.length === 0 ? '当前自由市场为空' : undefined}>
        {poolPlayers.map(p => {
          const canAfford = favTeamFinances && favTeamFinances.cash >= 5;
          return (
            <div key={p.uuid} className="flex items-center gap-2 p-2 bg-slate-800 rounded text-xs flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${POS_COLOR[p.position] ?? ''}`}>{POS_LABEL[p.position]}</span>
              <span className="text-slate-100 font-medium">{p.name ?? `${p.number}号`}</span>
              <span className="text-[10px] text-slate-500">能力 {p.rating} · {p.age ?? '?'}岁</span>
              <span className="text-amber-300 ml-auto">签字费 €5M</span>
              <button
                onClick={() => signFromFreeAgentPool(p.uuid)}
                disabled={!canAfford}
                className="text-[11px] px-3 py-1.5 min-h-[32px] bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-700 disabled:text-slate-500 rounded text-white"
              >签下</button>
            </div>
          );
        })}
      </Section>

      {/* Action footer */}
      <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur border-t border-slate-700/50 -mx-3 px-3 py-3 flex items-center justify-between flex-wrap gap-2 z-50">
        <div className="text-xs text-slate-500 basis-full sm:basis-auto">
          {pendingOffers.length + pendingTargets.length > 0
            ? `还有 ${pendingOffers.length} 个待定报价 + ${pendingTargets.length} 个候选未操作`
            : '所有决策已完成'}
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {(pendingOffers.length + pendingTargets.length > 0) && (
            <button
              onClick={() => closeTransferWindow(true)}
              className="text-xs px-3 py-2.5 min-h-[40px] bg-slate-700 hover:bg-slate-600 rounded text-slate-200 flex-1 sm:flex-none inline-flex items-center justify-center gap-1"
            ><Icon name="bolt" size={12} /> 全自动剩余</button>
          )}
          <button
            onClick={() => closeTransferWindow(false)}
            className="text-xs px-4 py-2.5 min-h-[40px] bg-emerald-700 hover:bg-emerald-600 rounded text-white font-semibold flex-1 sm:flex-none inline-flex items-center justify-center gap-1"
          ><Icon name="check" size={12} /> 完成转会窗口</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, emptyMessage, children }: { title: React.ReactNode; emptyMessage?: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/40 rounded-xl border border-slate-700/60 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
      {emptyMessage ? (
        <p className="text-xs text-slate-500">{emptyMessage}</p>
      ) : children}
    </div>
  );
}

function resolutionLabel(r: string): React.ReactNode {
  const wrap = (icon: React.ReactNode, txt: string) => (
    <span className="inline-flex items-center gap-1">{icon}{txt}</span>
  );
  switch (r) {
    case 'accepted': return wrap(<Icon name="check" size={11} />, '接受');
    case 'rejected': return wrap(<Icon name="x" size={11} />, '拒绝');
    case 'countered_accepted': return wrap(<Icon name="speech" size={11} />, '还价成功');
    case 'countered_rejected': return wrap(<Icon name="speech" size={11} />, '还价被拒');
    case 'bid_accepted': return wrap(<Icon name="outbox" size={11} />, '报价被接受');
    case 'bid_rejected': return wrap(<Icon name="outbox" size={11} />, '报价被拒');
    case 'skipped': return '— 跳过';
    default: return r;
  }
}
