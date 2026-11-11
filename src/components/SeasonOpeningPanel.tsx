import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  buildSeasonOpening,
  type OpeningDraw,
  type OpeningGroup,
  type OpeningTone,
} from '../engine/season/season-opening';
import type { GameWorld } from '../engine/season/season-manager';

const TONE_STYLES: Record<OpeningTone, { chip: string; bar: string }> = {
  stage: { chip: 'bg-amber-900/35 text-amber-200', bar: 'bg-amber-500' },
  rise: { chip: 'bg-emerald-900/35 text-emerald-200', bar: 'bg-emerald-500' },
  fall: { chip: 'bg-rose-900/35 text-rose-200', bar: 'bg-rose-500' },
  legacy: { chip: 'bg-violet-900/35 text-violet-200', bar: 'bg-violet-500' },
  transfer: { chip: 'bg-sky-900/35 text-sky-200', bar: 'bg-sky-500' },
};

const TONE_LABELS: Record<OpeningTone, string> = {
  stage: '格局',
  rise: '上升',
  fall: '变数',
  legacy: '传承',
  transfer: '转会',
};

function TeamLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to={`/team/${id}`} className="hover:text-slate-100 hover:underline">
      {name}
    </Link>
  );
}

function GroupTable({ group }: { group: OpeningGroup }) {
  return (
    <div className="rounded border border-slate-700/50 bg-slate-900/35 p-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="shrink-0 text-[11px] font-bold text-slate-200">{group.groupName} 组</span>
        {group.note ? (
          <span className="min-w-0 truncate rounded bg-amber-900/35 px-1.5 py-0.5 text-[10px] text-amber-200">
            {group.note}
          </span>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {group.teams.map(team => (
          <li key={team.teamId} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-slate-300">
              <TeamLink id={team.teamId} name={team.shortName} />
            </span>
            <span className="shrink-0 tabular-nums text-slate-500">{team.overall}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DrawCard({ draw }: { draw: OpeningDraw }) {
  return (
    <section className="rounded-lg border border-slate-700/60 bg-[var(--surface-panel)] p-3">
      <header className="mb-2">
        <h4 className="text-sm font-bold text-slate-100">{draw.title}</h4>
        <p className="mt-0.5 text-[11px] text-slate-500">{draw.rule}</p>
      </header>
      {draw.highlight ? (
        <p className="mb-2 rounded bg-amber-950/25 px-2 py-1.5 text-[11px] leading-5 text-amber-200">
          {draw.highlight}
        </p>
      ) : null}
      {draw.groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {draw.groups.map(group => <GroupTable key={group.groupName} group={group} />)}
        </div>
      ) : null}
      {draw.pairings.length > 0 ? (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {draw.pairings.map((pairing, index) => (
            <li
              key={`${pairing.homeId}:${pairing.awayId}:${index}`}
              className="flex items-center gap-1.5 text-[11px] text-slate-300"
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-slate-600">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-right">
                <TeamLink id={pairing.homeId} name={pairing.homeName} />
              </span>
              <span className="shrink-0 text-slate-600">vs</span>
              <span className="min-w-0 flex-1 truncate">
                <TeamLink id={pairing.awayId} name={pairing.awayName} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The season-opening window's content.
 *
 * Everything here is derived from world state by `buildSeasonOpening`, so the
 * panel holds no state of its own and the opening window needs no persisted
 * fields.
 */
export default function SeasonOpeningPanel({
  world,
  favoriteTeamIds,
}: {
  world: GameWorld;
  favoriteTeamIds: readonly string[];
}) {
  const opening = useMemo(
    () => buildSeasonOpening(world, { favoriteTeamIds }),
    [favoriteTeamIds, world],
  );

  return (
    <div data-testid="season-opening" className="space-y-4">
      <header className="rounded-lg border border-slate-700/60 bg-[var(--surface-panel)] px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-bold text-slate-100">第 {opening.seasonNumber} 赛季 · 开幕</h3>
          <span className="text-[11px] text-slate-500">抽签已揭晓，联赛尚未开打</span>
        </div>
      </header>

      {opening.draws.length > 0 ? (
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">本赛季抽签</h4>
          {opening.draws.map(draw => <DrawCard key={draw.key} draw={draw} />)}
        </div>
      ) : null}

      {opening.storylines.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">赛前瞩目</h4>
          <ul className="space-y-2">
            {opening.storylines.map(item => (
              <li
                key={item.key}
                className="relative overflow-hidden rounded border border-slate-700/50 bg-slate-900/35 py-2 pl-3 pr-2.5"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-0.5 ${TONE_STYLES[item.tone].bar}`}
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${TONE_STYLES[item.tone].chip}`}
                  >
                    {TONE_LABELS[item.tone]}
                  </span>
                  <h5 className="min-w-0 text-xs font-semibold text-slate-100">{item.title}</h5>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
