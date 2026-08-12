// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchResult } from '../types/match';
import { initializeGameWorld } from '../engine/season/season-manager';
import { buildAdvanceWorldResponse } from '../engine/observation/world-response';
import WorldResponseSummary from './WorldResponseSummary';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WorldResponseSummary', () => {
  it('renders one factual World Moment and the four-step result explanation', () => {
    const previousWorld = initializeGameWorld(20260812);
    const [homeTeamId, awayTeamId] = Object.keys(previousWorld.teamBases);
    const match: MatchResult = {
      fixtureId: 'test-final',
      homeTeamId,
      awayTeamId,
      homeGoals: 0,
      awayGoals: 1,
      extraTime: false,
      penalties: false,
      events: [{
        minute: 67,
        type: 'red_card',
        teamId: homeTeamId,
        playerId: 'test-player',
        playerName: '测试后卫',
        description: '测试后卫被罚下',
      }],
      stats: {
        possession: [54, 46],
        shots: [10, 8],
        shotsOnTarget: [4, 3],
        corners: [4, 2],
        fouls: [12, 9],
        yellowCards: [2, 1],
        redCards: [1, 0],
      },
      competitionType: 'league_cup',
      competitionName: '联赛杯',
      roundLabel: 'Final',
      prediction: {
        homeWinPct: 72,
        drawPct: 18,
        awayWinPct: 10,
        homeExpectedGoals: 1.8,
        awayExpectedGoals: 0.7,
        factors: [{
          source: 'team_strength',
          beneficiary: 'home',
          direction: 'positive',
          importance: 3,
          label: '主队实力占优',
          detail: '主队赛前整体能力更高。',
          evidenceValue: 8,
        }],
      },
    };
    const endWorld = structuredClone(previousWorld);
    endWorld.totalElapsedWindows = 1;
    endWorld.teamStates[homeTeamId].coachPressure += 10;
    const response = buildAdvanceWorldResponse(
      'cup',
      [{
        seasonNumber: 1,
        windowIndex: 0,
        windowLabel: '联赛杯决赛',
        results: [match],
        news: [],
        observationSettlements: [],
      }],
      endWorld,
      [homeTeamId],
      homeTeamId,
      { previousWorld },
    );
    const onResultClick = vi.fn();

    act(() => root.render(
      <MemoryRouter>
        <WorldResponseSummary
          response={response!}
          world={endWorld}
          onResultClick={onResultClick}
        />
      </MemoryRouter>,
    ));

    const sequence = container.querySelector('[data-testid="result-causality-sequence"]');
    expect(sequence?.children).toHaveLength(4);
    expect(sequence?.textContent).toContain('赛前条件');
    expect(sequence?.textContent).toContain('场上转折');
    expect(sequence?.textContent).toContain('结果偏离');
    expect(sequence?.textContent).toContain('推进后变化');
    expect(container.textContent).toContain('不代表任何单项因素必然造成赛果');
    expect(container.querySelectorAll('[data-testid="world-moment-feature"]')).toHaveLength(1);
    expect(container.querySelector('details[data-testid="result-why-mattered"]')?.hasAttribute('open')).toBe(false);
    expect(container.querySelector('details[data-testid="result-what-changed"]')?.hasAttribute('open')).toBe(false);

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="world-response-match"]')?.click());
    expect(onResultClick).toHaveBeenCalledWith(match);
  });
});
