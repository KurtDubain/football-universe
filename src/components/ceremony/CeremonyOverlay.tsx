import { useEffect, useRef, type CSSProperties } from 'react';
import type { CeremonyTiming } from './ceremony-motion';
import type { CeremonyRequest, CeremonyTeam } from './ceremony-types';
import './ceremony.css';

interface CeremonyOverlayProps {
  request: CeremonyRequest;
  /** Already resolved against the viewer motion preference by the director. */
  timing: CeremonyTiming;
  /** Milliseconds until the page turns itself, or null when it waits. */
  dismissAfter: number | null;
  onDismiss: () => void;
}

interface PageCopy {
  eyebrow: string;
  title: string;
  colophon: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function pageCopy(request: CeremonyRequest): PageCopy {
  switch (request.kind) {
    case 'season_opening':
      return {
        eyebrow: 'SEASON ' + pad(request.seasonNumber),
        title: '第 ' + request.seasonNumber + ' 赛季 · 开幕',
        colophon: '抽签已揭晓 · 联赛尚未开打',
      };
    case 'season_closing':
      return {
        eyebrow: 'SEASON ' + pad(request.seasonNumber),
        title: '第 ' + request.seasonNumber + ' 赛季 · 封盘',
        colophon: '赛季归档',
      };
    case 'cup_stamp':
      return {
        eyebrow: request.roundLabel,
        title: request.competitionName,
        colophon: '冠军已定',
      };
    case 'world_cup_opening':
      return {
        eyebrow: 'EDITION ' + pad(request.edition),
        title: '环球冠军杯 · 开幕',
        colophon: request.entrants.length + ' 队 · 全部中立场',
      };
    case 'world_cup_closing':
      return {
        eyebrow: 'EDITION ' + pad(request.edition),
        title: '环球冠军杯 · 闭幕',
        colophon: '奖杯归位',
      };
  }
}

function lineStyle(index: number, timing: CeremonyTiming): CSSProperties {
  return { '--ceremony-delay': timing.lead + timing.stagger * index + 'ms' } as CSSProperties;
}

function TeamSwatch({ team }: { team: CeremonyTeam }) {
  return (
    <span
      className="ceremony-swatch"
      style={{ backgroundColor: team.color }}
      aria-hidden="true"
    />
  );
}

function CeremonyBody({ request, timing }: { request: CeremonyRequest; timing: CeremonyTiming }) {
  switch (request.kind) {
    case 'season_opening':
      return (
        <>
          {request.draws.length > 0 ? (
            <ul className="ceremony-chips">
              {request.draws.map((draw, index) => (
                <li key={draw} className="ceremony-line" style={lineStyle(index, timing)}>
                  {draw}
                </li>
              ))}
            </ul>
          ) : null}
          {request.lines.map((line, index) => (
            <p
              key={line}
              className="ceremony-line ceremony-line--lead"
              style={lineStyle(request.draws.length + index, timing)}
            >
              {line}
            </p>
          ))}
        </>
      );

    case 'season_closing':
      return (
        <>
          <div className="ceremony-champion ceremony-line" style={lineStyle(0, timing)}>
            <p className="ceremony-champion-name ceremony-foil">
              {request.champion ? request.champion.name : '—'}
            </p>
          </div>
          <p className="ceremony-line ceremony-line--lead" style={lineStyle(1, timing)}>
            {request.summary}
          </p>
          {request.podium.length > 0 ? (
            <ol className="ceremony-podium">
              {request.podium.map((team, index) => (
                <li key={team.teamId} style={lineStyle(2 + index, timing)}>
                  <span className="ceremony-rank">{index + 1}</span>
                  <TeamSwatch team={team} />
                  <span>{team.name}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      );

    case 'cup_stamp':
      return (
        <>
          <div className="ceremony-champion ceremony-line" style={lineStyle(0, timing)}>
            <p className="ceremony-champion-name">{request.champion.name}</p>
            <p className="ceremony-score">{request.score}</p>
            {request.runnerUp ? (
              <p className="ceremony-versus">{'对手 ' + request.runnerUp.name}</p>
            ) : null}
          </div>
          <div className="ceremony-stamp" style={lineStyle(1, timing)}>
            <span className="ceremony-stamp-label">冠军</span>
            <span className="ceremony-stamp-sub">{request.champion.shortName}</span>
          </div>
        </>
      );

    case 'world_cup_opening':
      return (
        <>
          <p className="ceremony-line ceremony-line--lead" style={lineStyle(0, timing)}>
            {request.host ? '东道主 ' + request.host.name : '东道主待定'}
          </p>
          <ul className="ceremony-entrants ceremony-line" style={lineStyle(1, timing)}>
            {request.entrants.map(team => (
              <li key={team.teamId}>
                <TeamSwatch team={team} />
                <span>{team.shortName}</span>
              </li>
            ))}
          </ul>
        </>
      );

    case 'world_cup_closing':
      return (
        <>
          <div className="ceremony-champion ceremony-line" style={lineStyle(0, timing)}>
            <p className="ceremony-champion-name ceremony-foil">{request.champion.name}</p>
            <p className="ceremony-score">{request.finalScore}</p>
          </div>
          {request.honours.length > 0 ? (
            <ul className="ceremony-honours">
              {request.honours.map((honour, index) => (
                <li key={honour.label} style={lineStyle(1 + index, timing)}>
                  <span>{honour.label}</span>
                  <span>{honour.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      );
  }
}

/**
 * One page of the annual.
 *
 * Holds still when the moment deserves a page turn, and passes on by itself
 * when it is only a stamp. Escape, the scrim and the corner button all turn
 * the page, so nothing here can trap a viewer.
 *
 * Everything this component needs at runtime arrives as a prop. That is what
 * keeps it a single lazy chunk: an import back into the initial graph would be
 * extracted as a shared chunk and spend a precache entry on a page most
 * sessions never load.
 */
export default function CeremonyOverlay({
  request,
  timing,
  dismissAfter,
  onDismiss,
}: CeremonyOverlayProps) {
  const copy = pageCopy(request);
  const skipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    skipRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    if (dismissAfter === null) return;
    const timer = window.setTimeout(onDismiss, dismissAfter);
    return () => window.clearTimeout(timer);
  }, [dismissAfter, onDismiss]);

  return (
    <div
      className="ceremony-root"
      data-testid="ceremony-overlay"
      data-ceremony-kind={request.kind}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <button
        type="button"
        className="ceremony-scrim"
        tabIndex={-1}
        aria-label="关闭仪式页面"
        onClick={onDismiss}
      />
      <article className="ceremony-page">
        <span className="ceremony-rule" aria-hidden="true" />
        <p className="ceremony-eyebrow">{copy.eyebrow}</p>
        <h2 className="ceremony-title" data-text={copy.title}>{copy.title}</h2>
        <div className="ceremony-body">
          <CeremonyBody request={request} timing={timing} />
        </div>
        <p className="ceremony-colophon">{copy.colophon}</p>
      </article>
      <button
        ref={skipRef}
        type="button"
        className="ceremony-skip"
        data-testid="ceremony-skip"
        onClick={onDismiss}
      >
        {dismissAfter === null ? '翻页' : '跳过'}
      </button>
    </div>
  );
}
