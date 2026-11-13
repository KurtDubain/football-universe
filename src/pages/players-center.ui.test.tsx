// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeGameWorld } from '../engine/season/season-manager';
import { editionStorageKey } from '../edition/policy';
import { useGameStore } from '../store/game-store';
import type { PlayerAward } from '../types/award';
import Players from './Players';
import {
  MINUTES_THRESHOLD_NOTE,
  MIXED_POSITION_TABS,
  RANKING_SCOPE_NOTES,
  TABS_BY_GROUP,
  type RankingTab,
} from './players-ranking-copy';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const SEASON_TABS: RankingTab[] = TABS_BY_GROUP.season.map((entry) => entry.key);
const MIXED_TABS = new Set<string>(MIXED_POSITION_TABS);

/** Seeds `ui.players.*` the way a previous session would have left it. */
function mount(seed: Record<string, unknown> = {}) {
  if (root) act(() => root!.unmount());
  container?.remove();
  sessionStorage.clear();
  for (const [key, value] of Object.entries(seed)) {
    sessionStorage.setItem(editionStorageKey(`ui.players.${key}`), JSON.stringify(value));
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<MemoryRouter><Players /></MemoryRouter>);
  });
}

function tabList(label: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[role="tablist"][aria-label="${label}"]`) ?? null;
}

function tabLabels(label: string): string[] {
  const list = tabList(label);
  if (!list) return [];
  return [...list.querySelectorAll('[role="tab"]')].map((el) => el.textContent ?? '');
}

function text(): string {
  return container?.textContent ?? '';
}

/** Awards section text with the filter `<select>` option lists removed. */
function awardsText(): string {
  const section = container?.querySelector('section[aria-labelledby="player-awards-heading"]');
  if (!section) return '';
  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('select').forEach((element) => element.remove());
  return clone.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();

  const world = initializeGameWorld(2024);
  const [forward, midfielder] = Object.values(world.squads).flat()
    .filter((player) => player.position === 'FW' || player.position === 'MF');
  const team = world.teamBases[forward.teamId];
  const awards: PlayerAward[] = [
    {
      season: 3, type: 'mvp', playerId: forward.uuid, playerName: forward.name,
      playerNumber: forward.number, teamId: forward.teamId, teamName: team.name,
      statValue: 88, statLabel: '综合 88',
    },
    {
      season: 4, type: 'golden_boot', playerId: forward.uuid, playerName: forward.name,
      playerNumber: forward.number, teamId: forward.teamId, teamName: team.name,
      statValue: 27, statLabel: '27球',
    },
    {
      season: 4, type: 'best_midfielder', playerId: midfielder.uuid, playerName: midfielder.name,
      playerNumber: midfielder.number, teamId: midfielder.teamId,
      teamName: world.teamBases[midfielder.teamId].name,
      statValue: 12, statLabel: '12助攻',
    },
  ];

  useGameStore.setState({
    world: { ...world, playerAwardsHistory: awards },
    initialized: true,
    favoriteTeamId: null,
    favoriteTeamIds: [],
    favoritePlayerIds: [],
    starredFixtureIds: [],
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Players ranking information architecture', () => {
  it('offers exactly the 本季 / 生涯 / 奖项 groups with eight season boards', () => {
    mount();
    expect(tabLabels('榜单分组')).toEqual(['本季', '生涯', '奖项']);
    expect(tabLabels('球员榜单')).toEqual([
      '综合', '射手', '助攻', '创造力', '前锋', '防守', '门将', '纪律',
    ]);
  });

  it('drops the removed 位置 group and falls back to 本季 for any unknown saved value', () => {
    mount({ 'ranking-group': 'position' });
    expect(tabLabels('榜单分组')).toEqual(['本季', '生涯', '奖项']);
    expect(tabLabels('球员榜单')).toHaveLength(8);

    mount({ 'ranking-group': '位置' });
    expect(tabLabels('球员榜单')).toHaveLength(8);
  });

  it('keeps the career group at two boards', () => {
    mount({ 'ranking-group': 'career', tab: 'careerScorers' });
    expect(tabLabels('球员榜单')).toEqual(['生涯射手', '生涯助攻']);
  });

  it('shows the position filter only on mixed boards', () => {
    for (const key of SEASON_TABS) {
      mount({ tab: key });
      const present = tabList('位置筛选') !== null;
      expect(present, `${key} position filter`).toBe(MIXED_TABS.has(key));
    }
    mount({ 'ranking-group': 'career', tab: 'careerScorers' });
    expect(tabList('位置筛选')).toBeNull();
  });

  it('states each board\'s measurement basis and the minutes floor', () => {
    for (const key of SEASON_TABS) {
      mount({ tab: key });
      expect(text(), key).toContain(RANKING_SCOPE_NOTES[key]);
      expect(text(), key).toContain(MINUTES_THRESHOLD_NOTE);
    }
    for (const key of ['careerScorers', 'careerAssists'] as RankingTab[]) {
      mount({ 'ranking-group': 'career', tab: key });
      expect(text(), key).toContain(RANKING_SCOPE_NOTES[key]);
      expect(text(), key).not.toContain(MINUTES_THRESHOLD_NOTE);
    }
  });

  it('renders the awards group with two views and three filters', () => {
    mount({ 'ranking-group': 'awards' });
    expect(tabLabels('奖项视图')).toEqual(['获奖记录', '得奖排行']);
    expect(tabList('球员榜单')).toBeNull();
    expect(tabList('位置筛选')).toBeNull();

    const selects = [...(container?.querySelectorAll('select') ?? [])]
      .map((el) => el.getAttribute('aria-label'));
    expect(selects).toEqual(['奖项类型', '赛季范围', '球队']);

    // 获奖记录: newest season first, award emoji + label, linked player, team, stat.
    const links = [...(container?.querySelectorAll('a[href^="/player/"]') ?? [])];
    expect(links.length).toBeGreaterThan(0);
    expect(awardsText()).toContain('S4');
    expect(awardsText()).toContain('金靴奖');
    expect(awardsText()).toContain('27球');
    expect(awardsText()).toContain(teamNameOfFirstRecord());
    // Newest season first: S4 rows precede the S3 Ballon d'Or row.
    expect(awardsText().indexOf('S4')).toBeLessThan(awardsText().indexOf('S3'));
  });

  it('aggregates the 得奖排行 view per player', () => {
    mount({ 'ranking-group': 'awards', 'award-view': 'leaders' });
    expect(awardsText()).toContain('金球 ×1 · 金靴 ×1');
    expect(awardsText()).toContain('最佳中场 ×1');
  });

  it('applies persisted award filters', () => {
    mount({
      'ranking-group': 'awards',
      'award-filters': { type: 'golden_boot', seasons: '10', teamId: 'all' },
    });
    expect(awardsText()).toContain('1 条获奖记录');
    expect(awardsText()).toContain('金靴奖');
    expect(awardsText()).not.toContain('最佳中场');
    expect(awardsText()).not.toContain('金球奖');
  });
});

function teamNameOfFirstRecord(): string {
  const world = useGameStore.getState().world!;
  const first = world.playerAwardsHistory[0];
  return world.teamBases[first.teamId].name;
}
