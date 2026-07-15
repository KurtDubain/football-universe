// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchEvent, MatchResult } from '../types/match';
import type { TeamBase } from '../types/team';
import type { NewsItem } from '../engine/season/season-manager';
import MatchLive from './MatchLive';
import ResultAnimation from './ResultAnimation';
import NewsTicker from './NewsTicker';

vi.mock('./PitchCanvas', () => ({
  default: () => <div data-testid="pitch" />,
}));

vi.mock('./CanvasEffects', () => ({
  EnergyWave: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const teamBases: Record<string, TeamBase> = {
  home: makeTeam('home', '主队', 80),
  away: makeTeam('away', '客队', 78),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function makeTeam(id: string, name: string, overall: number): TeamBase {
  return {
    id,
    name,
    shortName: name,
    color: id === 'home' ? '#ef4444' : '#3b82f6',
    tier: 'mid',
    overall,
    attack: overall,
    midfield: overall,
    defense: overall,
    stability: overall,
    depth: overall,
    reputation: overall,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

function makeResult(
  fixtureId: string,
  events: MatchEvent[] = [],
  overrides: Partial<MatchResult> = {},
): MatchResult {
  return {
    fixtureId,
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: events.filter(event => event.type === 'goal' && event.teamId === 'home').length,
    awayGoals: events.filter(event => event.type === 'goal' && event.teamId === 'away').length,
    extraTime: false,
    penalties: false,
    events,
    stats: {
      possession: [50, 50],
      shots: [8, 7],
      shotsOnTarget: [3, 2],
      corners: [4, 3],
      fouls: [10, 9],
      yellowCards: [0, 0],
      redCards: [0, 0],
    },
    competitionType: 'league',
    competitionName: '测试联赛',
    roundLabel: 'R1',
    ...overrides,
  };
}

function render(ui: ReactNode): void {
  act(() => root.render(ui));
}

function advance(milliseconds: number): void {
  act(() => vi.advanceTimersByTime(milliseconds));
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .find(element => element.textContent?.includes(label));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match as HTMLButtonElement;
}

function score(label: string): string | null {
  return container.querySelector(`[aria-label="${label}"]`)?.textContent ?? null;
}

function news(id: string, title: string, type: NewsItem['type']): NewsItem {
  return { id, title, type, description: `${title}详情`, seasonNumber: 1, windowIndex: 0 };
}

describe('MatchLive playback state machine', () => {
  const goalEvents: MatchEvent[] = [
    { minute: 2, type: 'goal', teamId: 'home', playerId: 'p1', description: '主队破门' },
    { minute: 2, type: 'assist', teamId: 'home', playerId: 'p2', description: '送出助攻' },
  ];

  it('reveals events and score from one event cursor', () => {
    render(<MatchLive result={makeResult('live-a', goalEvents)} teamBases={teamBases} onClose={() => undefined} />);

    expect(score('主队比分')).toBe('0');
    advance(560);

    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("2'");
    expect(score('主队比分')).toBe('1');
    expect(score('客队比分')).toBe('0');
    expect(container.textContent).toContain('主队破门');
    expect(container.textContent).toContain('进球了');
  });

  it('pauses manually and resumes after the dedicated halftime delay', () => {
    render(<MatchLive result={makeResult('live-b')} teamBases={teamBases} onClose={() => undefined} />);

    act(() => button('暂停').click());
    advance(1000);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("0'");
    act(() => button('继续').click());
    advance(280);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("1'");

    advance(44 * 280);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("45'");
    expect(container.textContent).toContain('中场休息');
    advance(1999);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("45'");
    advance(1);
    advance(280);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("46'");
  });

  it('makes rapid skip idempotent and resets when a different result opens', () => {
    const first = makeResult('live-c', goalEvents);
    render(<MatchLive result={first} teamBases={teamBases} onClose={() => undefined} />);

    const skip = button('跳过');
    act(() => {
      skip.click();
      skip.click();
    });
    expect(container.textContent).toContain('全场结束');
    expect(score('主队比分')).toBe('1');
    expect(container.textContent?.match(/主队破门/g)).toHaveLength(1);

    render(<MatchLive result={makeResult('live-d')} teamBases={teamBases} onClose={() => undefined} />);
    expect(container.querySelector('[data-testid="live-minute"]')?.textContent).toBe("0'");
    expect(score('主队比分')).toBe('0');
  });

  it('clears every playback timer on unmount', () => {
    render(<MatchLive result={makeResult('live-e', goalEvents)} teamBases={teamBases} onClose={() => undefined} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});

describe('ResultAnimation completion lifecycle', () => {
  it('reveals normally and calls completion exactly once', () => {
    const onComplete = vi.fn();
    render(<ResultAnimation
      results={[makeResult('result-a')]}
      teamBases={teamBases}
      onComplete={onComplete}
      onResultClick={() => undefined}
    />);

    advance(600);
    expect(container.textContent).toContain('主队');
    advance(800);
    expect(onComplete).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('makes repeated skip clicks idempotent', () => {
    const onComplete = vi.fn();
    render(<ResultAnimation
      results={[makeResult('result-b'), makeResult('result-c')]}
      teamBases={teamBases}
      onComplete={onComplete}
      onResultClick={() => undefined}
    />);

    const skip = button('跳过');
    act(() => {
      skip.click();
      skip.click();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('fully resets for a replacement batch and handles an empty batch', () => {
    const onComplete = vi.fn();
    render(<ResultAnimation
      results={[makeResult('result-d')]}
      teamBases={teamBases}
      onComplete={onComplete}
      onResultClick={() => undefined}
    />);
    act(() => button('跳过').click());
    expect(onComplete).toHaveBeenCalledTimes(1);

    render(<ResultAnimation
      results={[makeResult('result-e')]}
      teamBases={teamBases}
      onComplete={onComplete}
      onResultClick={() => undefined}
    />);
    expect(container.textContent).toContain('0/1');
    act(() => button('跳过').click());
    expect(onComplete).toHaveBeenCalledTimes(2);

    render(<ResultAnimation
      results={[]}
      teamBases={teamBases}
      onComplete={onComplete}
      onResultClick={() => undefined}
    />);
    advance(800);
    expect(onComplete).toHaveBeenCalledTimes(3);
  });
});

describe('NewsTicker list replacement', () => {
  it('tracks a stable news id across rotation, same-length replacement, and shrink', () => {
    render(<NewsTicker news={[
      news('normal', '普通赛果', 'match_result'),
      news('important', '冠军诞生', 'trophy'),
    ]} />);
    expect(container.querySelector('p')?.textContent).toBe('冠军诞生');
    advance(4500);
    expect(container.querySelector('p')?.textContent).toBe('普通赛果');

    render(<NewsTicker news={[
      news('replacement-a', '换帅新闻', 'coach_fired'),
      news('replacement-b', '转会传闻', 'rumor'),
    ]} />);
    expect(container.querySelector('p')?.textContent).toBe('换帅新闻');

    render(<NewsTicker news={[news('only', '唯一新闻', 'injury')]} />);
    expect(container.querySelector('p')?.textContent).toBe('唯一新闻');
    advance(9000);
    expect(container.querySelector('p')?.textContent).toBe('唯一新闻');
  });
});
