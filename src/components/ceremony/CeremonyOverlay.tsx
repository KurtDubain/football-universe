import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CeremonyTiming } from './ceremony-motion';
import type { CeremonyHonour, CeremonyRequest, CeremonyTeam } from './ceremony-types';
import './ceremony.css';

interface CeremonyOverlayProps {
  request: CeremonyRequest;
  /** Already resolved against the viewer motion preference by the director. */
  timing: CeremonyTiming;
  /** Milliseconds until the page turns itself, or null when it waits. */
  dismissAfter: number | null;
  onDismiss: () => void;
}

/**
 * One leaf of the annual.
 *
 * A ceremony with more to say than a single page carries several of these and
 * turns through them; the last one is what closes the overlay.
 */
interface CeremonyPage {
  eyebrow: string;
  title: string;
  colophon: string;
  body: ReactNode;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
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

/**
 * An honours list.
 *
 * Label, winner, and the fact that won it. The colour plate belongs to the
 * club, so a reader can find their own side without reading the name.
 */
function HonourList({
  honours,
  timing,
  offset = 0,
}: {
  honours: CeremonyHonour[];
  timing: CeremonyTiming;
  offset?: number;
}) {
  return (
    <ul className="ceremony-honours ceremony-honours--full">
      {honours.map((honour, index) => (
        <li key={honour.label} style={lineStyle(offset + index, timing)}>
          <span className="ceremony-honour-label">{honour.label}</span>
          <span className="ceremony-honour-name">
            {honour.team ? <TeamSwatch team={honour.team} /> : null}
            {honour.name}
          </span>
          <span className="ceremony-honour-detail">{honour.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function buildPages(request: CeremonyRequest, timing: CeremonyTiming): CeremonyPage[] {
  switch (request.kind) {
    case 'season_opening':
      return [{
        eyebrow: 'SEASON ' + pad(request.seasonNumber),
        title: '第 ' + request.seasonNumber + ' 赛季 · 开幕',
        colophon: '抽签已揭晓 · 联赛尚未开打',
        body: (
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
        ),
      }];

    case 'season_closing': {
      const eyebrow = 'SEASON ' + pad(request.seasonNumber);
      const pages: CeremonyPage[] = [{
        eyebrow,
        title: '第 ' + request.seasonNumber + ' 赛季 · 封盘',
        colophon: '赛季归档',
        body: (
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
                {request.podium.map((entry, index) => (
                  <li key={entry.team.teamId} style={lineStyle(2 + index, timing)}>
                    <span className="ceremony-rank">{index + 1}</span>
                    <TeamSwatch team={entry.team} />
                    <span>{entry.team.name}</span>
                    <span className="ceremony-podium-points">{entry.points + ' 分'}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ),
      }];

      if (request.playerHonours.length > 0) {
        pages.push({
          eyebrow,
          title: '个人荣誉',
          colophon: request.playerHonours.length + ' 项个人奖',
          body: <HonourList honours={request.playerHonours} timing={timing} />,
        });
      }
      if (request.coachHonours.length > 0) {
        pages.push({
          eyebrow,
          title: '教练席',
          colophon: request.coachHonours.length + ' 项教练奖',
          body: <HonourList honours={request.coachHonours} timing={timing} />,
        });
      }
      return pages;
    }

    case 'cup_stamp': {
      const extras = [request.finalMvp, request.topScorer].filter(
        (honour): honour is CeremonyHonour => honour !== null,
      );
      return [{
        eyebrow: request.roundLabel,
        title: request.competitionName,
        colophon: '冠军已定',
        body: (
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
            {extras.length > 0 ? (
              <HonourList honours={extras} timing={timing} offset={2} />
            ) : null}
          </>
        ),
      }];
    }

    case 'world_cup_opening':
      return [{
        eyebrow: 'EDITION ' + pad(request.edition),
        title: '环球冠军杯 · 开幕',
        colophon: request.entrants.length + ' 队 · 全部中立场',
        body: (
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
        ),
      }];

    case 'world_cup_closing':
      return [{
        eyebrow: 'EDITION ' + pad(request.edition),
        title: '环球冠军杯 · 闭幕',
        colophon: '奖杯归位',
        body: (
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
        ),
      }];
  }
}

/**
 * The pages of the annual, turned one at a time.
 *
 * Holds still when the moment deserves a page turn, and passes on by itself
 * when it is only a stamp. Escape, the scrim and the corner button all turn the
 * page, so nothing here can trap a viewer: on the last page, turning it is what
 * closes the overlay.
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
  const pages = buildPages(request, timing);
  const [pageIndex, setPageIndex] = useState(0);
  const skipRef = useRef<HTMLButtonElement>(null);

  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const isLast = pageIndex >= pages.length - 1;

  const turn = () => {
    if (isLast) {
      onDismiss();
      return;
    }
    setPageIndex(index => index + 1);
  };

  useEffect(() => {
    skipRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') turn();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    if (dismissAfter === null) return;
    const timer = window.setTimeout(turn, dismissAfter);
    return () => window.clearTimeout(timer);
  });

  return (
    <div
      className="ceremony-root"
      data-testid="ceremony-overlay"
      data-ceremony-kind={request.kind}
      data-ceremony-page={pageIndex + 1}
      data-ceremony-pages={pages.length}
      role="dialog"
      aria-modal="true"
      aria-label={page.title}
    >
      <button
        type="button"
        className="ceremony-scrim"
        tabIndex={-1}
        aria-label="关闭仪式页面"
        onClick={turn}
      />
      <article className="ceremony-page" key={pageIndex}>
        <span className="ceremony-rule" aria-hidden="true" />
        <p className="ceremony-eyebrow">{page.eyebrow}</p>
        <h2 className="ceremony-title" data-text={page.title}>{page.title}</h2>
        <div className="ceremony-body">
          {page.body}
        </div>
        <p className="ceremony-colophon">
          {pages.length > 1 ? (
            <span className="ceremony-folio" data-testid="ceremony-folio">
              {(pageIndex + 1) + ' / ' + pages.length}
            </span>
          ) : null}
          {page.colophon}
        </p>
      </article>
      <button
        ref={skipRef}
        type="button"
        className="ceremony-skip"
        data-testid="ceremony-skip"
        onClick={turn}
      >
        {isLast ? (dismissAfter === null ? '合上' : '跳过') : '翻页'}
      </button>
    </div>
  );
}
