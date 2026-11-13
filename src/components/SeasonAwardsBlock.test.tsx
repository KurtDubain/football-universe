// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerAward, PlayerAwardType } from '../types/award';
import SeasonAwardsBlock, {
  AWARDS_ARCHIVED_HINT,
  type SeasonAwardsBlockProps,
} from './SeasonAwardsBlock';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AWARD_TYPES: PlayerAwardType[] = [
  'mvp',
  'golden_boot',
  'best_forward',
  'best_midfielder',
  'best_defender',
  'best_goalkeeper',
  'young_player',
];

function award(type: PlayerAwardType, index: number): PlayerAward {
  return {
    season: 12,
    type,
    playerId: `p-${type}`,
    playerName: `球员${index + 1}`,
    playerNumber: 10 + index,
    teamId: `t${index + 1}`,
    teamName: `球队${index + 1}`,
    statValue: 20 + index,
    statLabel: `${20 + index}球`,
  };
}

const fullAwards = AWARD_TYPES.map(award);

let container: HTMLDivElement;
let root: Root;

function render(props: SeasonAwardsBlockProps) {
  act(() => root.render(
    <MemoryRouter>
      <SeasonAwardsBlock {...props} />
    </MemoryRouter>,
  ));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SeasonAwardsBlock', () => {
  it('渲染该赛季全部 7 个奖项，球员名可点跳转 /player/{id}', () => {
    render({ awards: fullAwards, archived: false, topScorer: null });

    const grid = container.querySelector('[data-testid="season-awards-grid"]');
    expect(grid).not.toBeNull();

    const links = [...(grid as HTMLElement).querySelectorAll('a')];
    expect(links).toHaveLength(7);
    expect(links.map(link => link.getAttribute('href')))
      .toEqual(AWARD_TYPES.map(type => `/player/p-${type}`));

    const text = (grid as HTMLElement).textContent ?? '';
    expect(text).toContain('金球奖');
    expect(text).toContain('金靴奖');
    expect(text).toContain('最佳新星');
    expect(text).toContain('球员1');
    expect(text).toContain('球队1');
    expect(text).toContain('20球');

    expect(container.querySelector('[data-testid="season-awards-archived"]')).toBeNull();
  });

  it('已归档赛季只显示归档提示，不渲染颁奖典礼区块', () => {
    render({ awards: [], archived: true, topScorer: null });

    const hint = container.querySelector('[data-testid="season-awards-archived"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe(AWARDS_ARCHIVED_HINT);
    expect(hint?.textContent).toContain('记录已归档');

    expect(container.querySelector('[data-testid="season-awards-block"]')).toBeNull();
    expect(container.querySelector('[data-testid="season-awards-grid"]')).toBeNull();
  });

  it('窗口内无奖项记录时不显示归档提示，也不渲染空区块', () => {
    render({ awards: [], archived: false, topScorer: null });

    expect(container.querySelector('[data-testid="season-awards-archived"]')).toBeNull();
    expect(container.querySelector('[data-testid="season-awards-block"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('射手王显示可点球员名、球队与引擎给出的联赛口径说明', () => {
    render({
      awards: [],
      archived: false,
      topScorer: {
        playerId: 'p9',
        playerName: '射手王',
        teamName: '球队9',
        teamColor: '#123456',
        label: '联赛 18球',
      },
    });

    const row = container.querySelector('[data-testid="season-top-scorer"]');
    expect(row).not.toBeNull();

    const link = (row as HTMLElement).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/player/p9');
    expect(link?.textContent).toBe('射手王');

    const text = (row as HTMLElement).textContent ?? '';
    expect(text).toContain('赛季射手王');
    expect(text).toContain('球队9');
    expect(text).toContain('联赛 18球');
    expect(container.querySelector('[data-testid="season-awards-archived"]')).toBeNull();
  });

  it('归档优先于射手王：有射手王数据时也只显示归档提示', () => {
    render({
      awards: [],
      archived: true,
      topScorer: {
        playerId: 'p9',
        playerName: '射手王',
        teamName: '球队9',
        label: '联赛 18球',
      },
    });

    expect(container.querySelector('[data-testid="season-awards-archived"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="season-top-scorer"]')).toBeNull();
  });
});
