import { Link } from 'react-router-dom';
import type { GameWorld, NewsItem } from '../engine/season/season-manager';
import {
  advanceModeLabel,
  type AdvanceWorldResponse,
  type WorldResponseMatch,
} from '../engine/observation/world-response';
import {
  analyzeDestinyDeviation,
  resolveMatchOutcome,
} from '../engine/match/analysis';
import type { NarrativeFact, NarrativeItem } from '../engine/observation/narrative-types';
import type { MatchResult } from '../types/match';
import { getTeamShortName } from '../utils/format';
import { Icon } from './Icon';
import ObservationSettlementSummary from './ObservationSettlementSummary';
import { WorldMomentFeature } from './WorldMomentFeature';
import { worldMomentKindForNews } from './world-moment';

function scoreLabel(result: MatchResult): string {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  if (result.penalties) {
    return `${home}:${away} 点 ${result.penaltyHome ?? 0}:${result.penaltyAway ?? 0}`;
  }
  return `${home}:${away}`;
}

function focusOutcome(match: WorldResponseMatch): { label: string; tone: string } {
  const deviation = analyzeDestinyDeviation(match.result);
  if (!match.focusTeamId) {
    return {
      label: deviation.label,
      tone: deviation.isUpset ? 'text-rose-300' : 'text-slate-400',
    };
  }
  const outcome = resolveMatchOutcome(match.result);
  const focusIsHome = match.result.homeTeamId === match.focusTeamId;
  const won = (outcome === 'home' && focusIsHome) || (outcome === 'away' && !focusIsHome);
  const lost = (outcome === 'away' && focusIsHome) || (outcome === 'home' && !focusIsHome);
  if (won) return { label: deviation.isUpset ? '爆冷取胜' : '取胜', tone: 'text-emerald-300' };
  if (lost) return { label: '失利', tone: 'text-rose-300' };
  return { label: '战平', tone: 'text-amber-300' };
}

function ChangeRow({ news }: { news: NewsItem }) {
  const isStory = news.type === 'storyline';
  return (
    <div
      data-testid={isStory ? 'world-response-story' : 'world-response-news'}
      className="border-t border-slate-700/45 py-2 first:border-t-0"
    >
      <div className="flex items-start gap-2">
        <Icon
          name={isStory ? 'trend-up' : news.type === 'trophy' ? 'trophy' : 'news'}
          size={15}
          className={isStory ? 'mt-0.5 text-emerald-300' : 'mt-0.5 text-amber-300'}
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">{news.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{news.description}</p>
        </div>
      </div>
    </div>
  );
}

function NarrativeChangeRow({ item }: { item: NarrativeItem }) {
  const icon = item.source === 'storyline'
    ? 'trend-up'
    : item.source === 'player_highlight'
      ? 'star-glow'
      : item.source === 'transfer_rumor'
        ? 'handshake'
        : 'news';
  return (
    <div data-testid="world-response-narrative-change" className="border-t border-slate-700/45 py-2 first:border-t-0">
      <div className="flex items-start gap-2">
        <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">{item.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{item.summary}</p>
        </div>
      </div>
    </div>
  );
}

function CausalityStep({
  index,
  label,
  facts,
  fallback,
}: {
  index: string;
  label: string;
  facts: NarrativeFact[] | undefined;
  fallback: string;
}) {
  const lead = facts?.[0];
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-t border-slate-700/40 py-1.5 first:border-t-0 sm:py-2">
      <span className="font-mono text-[11px] text-slate-600">{index}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-300">{label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
          {lead ? <><span className="text-slate-400">{lead.label}</span>{' · '}{lead.detail}</> : fallback}
        </p>
      </div>
    </div>
  );
}

function FactDetails({ facts }: { facts: NarrativeFact[] }) {
  return (
    <div className="divide-y divide-slate-700/35">
      {facts.map(item => (
        <div key={item.key} className="py-2 text-[11px] leading-4">
          <p className="font-semibold text-slate-300">{item.label}</p>
          <p className="mt-0.5 text-slate-500">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function ResultCausality({ item }: { item: NarrativeItem }) {
  const deviation = item.evidence?.filter(entry => entry.key.includes(':deviation')) ?? [];
  const whyFacts = [...(item.causes ?? []), ...(item.evidence ?? [])];
  const changedFacts = item.consequences ?? [];
  return (
    <section data-testid="result-causality" className="mt-2 border-t border-slate-700/50 pt-2">
      <div className="flex items-start gap-2 pb-1">
        <Icon name="chart" size={15} className="mt-0.5 shrink-0 text-blue-300" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">{item.title}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{item.summary}</p>
        </div>
      </div>
      <div data-testid="result-causality-sequence">
        <CausalityStep
          index="01"
          label="赛前条件"
          facts={item.causes}
          fallback="双方没有冻结到足够显著的单项条件。"
        />
        <CausalityStep
          index="02"
          label="场上转折"
          facts={item.turningPoints}
          fallback="没有可可靠提取的关键转折；比分与比赛数据仍然有效。"
        />
        <CausalityStep
          index="03"
          label="结果偏离"
          facts={deviation}
          fallback="该结果没有足够的赛前分布用于偏离判断。"
        />
        <CausalityStep
          index="04"
          label="推进后变化"
          facts={item.consequences}
          fallback="当前没有可直接记录的排名、压力或奖杯变化。"
        />
      </div>
      <p className="border-t border-slate-700/35 pt-2 text-[11px] leading-4 text-slate-600">
        赛前条件解释概率倾向，不代表任何单项因素必然造成赛果。
      </p>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {whyFacts.length > 1 && (
          <details data-testid="result-why-mattered" className="border-t border-slate-700/35">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-blue-300">
              <Icon name="eye" size={14} />
              为什么重要
              <Icon name="arrow-down" size={13} className="ml-auto details-chevron" />
            </summary>
            <FactDetails facts={whyFacts} />
          </details>
        )}
        {changedFacts.length > 0 && (
          <details data-testid="result-what-changed" className="border-t border-slate-700/35">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-emerald-300">
              <Icon name="trend-up" size={14} />
              接下来发生了什么
              <Icon name="arrow-down" size={13} className="ml-auto details-chevron" />
            </summary>
            <FactDetails facts={changedFacts} />
          </details>
        )}
      </div>
    </section>
  );
}

export default function WorldResponseSummary({
  response,
  world,
  onResultClick,
  onSeasonReview,
}: {
  response: AdvanceWorldResponse;
  world: GameWorld;
  onResultClick: (result: MatchResult) => void;
  onSeasonReview?: () => void;
}) {
  const changes = [...response.storyUpdates, ...response.keyNews]
    .filter((item, index, all) => all.findIndex(entry => entry.id === item.id) === index)
    .slice(0, 3);
  const narrativeFeature = response.narrative?.feature;
  const primaryFixtureId = response.featuredResults[0]?.result.fixtureId;
  const narrativeItems = [
    response.narrative?.feature,
    ...(response.narrative?.signals ?? []),
    ...(response.narrative?.more ?? []),
  ].filter((item): item is NarrativeItem => Boolean(item));
  const causalityItem = narrativeItems.find(item => (
    item.source === 'match_result' && item.fixtureIds?.includes(primaryFixtureId ?? '')
  )) ?? narrativeItems.find(item => item.source === 'match_result');
  const structuredMoment = narrativeFeature?.visualKind ? narrativeFeature : undefined;
  const worldMoment = structuredMoment
    ? undefined
    : changes.find(news => worldMomentKindForNews(news) !== null);
  const secondaryChanges = changes.filter(news => news.id !== worldMoment?.id);
  const narrativeChanges = [
    ...(narrativeFeature && narrativeFeature.source !== 'match_result' && !structuredMoment
      ? [narrativeFeature]
      : []),
    ...(response.narrative?.signals ?? []).filter(item => item.source !== 'match_result'),
  ].slice(0, 3);
  const hiddenMatches = Math.max(0, response.completedMatches - response.featuredResults.length);
  const hiddenNews = Math.max(0, response.totalNews - changes.length);

  return (
    <section
      data-testid="world-response"
      className={`border-y py-3 ${response.hasMajorMoment
        ? 'border-emerald-700/55'
        : 'border-slate-700/60'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            name={response.hasMajorMoment ? 'sparkle' : 'eye'}
            size={18}
            className={response.hasMajorMoment ? 'mt-0.5 text-emerald-300' : 'mt-0.5 text-slate-400'}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">本次世界回应</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {advanceModeLabel(response.mode, response.advancedWindows)}
              {' · '}
              S{response.fromSeason} {response.fromLabel}
              {response.advancedWindows > 1 ? ` → S${response.toSeason} ${response.toLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
            {response.completedMatches}场
          </span>
          {response.seasonChanged && (
            <span className="rounded bg-amber-950/70 px-1.5 py-0.5 text-amber-300">
              进入 S{response.nextSeason}
            </span>
          )}
        </div>
      </div>

      {response.seasonChanged && (
        <div data-testid="season-boundary-summary" className="mt-3 flex flex-wrap items-center gap-3 border-y border-amber-800/45 bg-amber-950/20 px-3 py-2.5">
          <Icon name="trophy" size={18} className="shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-200">已在赛季边界停下</p>
            <p className="mt-0.5 text-[11px] text-slate-400">S{response.fromSeason} 档案已经生成，S{response.nextSeason} 的首轮尚未推进。</p>
          </div>
          {onSeasonReview && (
            <button
              type="button"
              data-testid="open-season-review"
              onClick={onSeasonReview}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded border border-amber-700/55 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-900/35"
            >
              <Icon name="eye" size={14} />
              查看 S{response.fromSeason} 档案
            </button>
          )}
        </div>
      )}

      {structuredMoment ? (
        <div className="mt-3">
          <WorldMomentFeature
            kind={structuredMoment.visualKind!}
            title={structuredMoment.title}
            description={structuredMoment.summary}
            seasonNumber={structuredMoment.seasonNumber}
          />
        </div>
      ) : worldMoment ? (
        <div className="mt-3">
          <WorldMomentFeature news={worldMoment} />
        </div>
      ) : null}

      {response.featuredResults.length > 0 && (
        <div className="mt-2">
          {response.featuredResults.map((match) => {
            const outcome = focusOutcome(match);
            const home = getTeamShortName(match.result.homeTeamId, world.teamBases);
            const away = getTeamShortName(match.result.awayTeamId, world.teamBases);
            return (
              <button
                key={`${match.seasonNumber}-${match.result.fixtureId}`}
                type="button"
                data-testid="world-response-match"
                data-fixture-id={match.result.fixtureId}
                onClick={() => onResultClick(match.result)}
                className="flex min-h-11 w-full items-center gap-2 border-t border-slate-700/45 py-2 text-left first:border-t-0 hover:bg-slate-800/45"
              >
                <span className={`w-14 shrink-0 text-[11px] font-semibold ${outcome.tone}`}>{outcome.label}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-slate-200" title={home}>{home}</span>
                <strong className="shrink-0 text-sm text-white">{scoreLabel(match.result)}</strong>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200" title={away}>{away}</span>
                <span className="hidden shrink-0 text-[11px] text-slate-600 sm:inline">
                  {match.result.competitionName}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {causalityItem && (
        <ResultCausality item={causalityItem} />
      )}

      <div className={response.observationSettlements.length > 0 ? 'mt-2' : undefined}>
        <ObservationSettlementSummary
          settlements={response.observationSettlements}
          record={world.observationRecord}
          teamBases={world.teamBases}
        />
      </div>

      {(narrativeChanges.length > 0 || secondaryChanges.length > 0) && (
        <div className="mt-2" data-testid="world-response-changes">
          {narrativeChanges.length > 0
            ? narrativeChanges.map(item => <NarrativeChangeRow key={item.id} item={item} />)
            : secondaryChanges.map(news => <ChangeRow key={news.id} news={news} />)}
        </div>
      )}

      {(hiddenMatches > 0 || hiddenNews > 0 || response.nextWindowLabel) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-700/45 pt-2 text-[11px] text-slate-600">
          {hiddenMatches > 0 && <span>另有 {hiddenMatches} 场赛果</span>}
          {hiddenNews > 0 && <span>另有 {hiddenNews} 条动态</span>}
          {response.nextWindowLabel && <span className="ml-auto text-slate-500">下一站：{response.nextWindowLabel}</span>}
        </div>
      )}
      {world.transferWindow?.status === 'open' && (
        <div className="mt-2 border-t border-amber-800/35 pt-2 text-right">
          <Link
            to="/market"
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
          >
            <Icon name="handshake" size={15} />
            处理转会窗口
          </Link>
        </div>
      )}
    </section>
  );
}
