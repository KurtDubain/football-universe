// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CupFixture, CupRound } from '../types/cup';
import type { TeamBase, TeamState } from '../types/team';
import { BracketView } from '../components/CupBracket';
import { buildDisplayRounds, buildMergedRounds, type TieClickHandler } from '../components/cup-bracket-model';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function team(id: string, name: string, shortName: string, color: string): TeamBase {
  return {
    id,
    name,
    shortName,
    color,
    tier: 'mid',
    overall: 80,
    attack: 80,
    midfield: 80,
    defense: 80,
    stability: 80,
    depth: 80,
    reputation: 80,
    initialLeagueLevel: 1,
    expectation: 3,
    region: '大陆+测试',
  };
}

const teamBases = {
  a: team('a', '广州恒大足球俱乐部', '恒大', '#ef4444'),
  b: team('b', '北京国安足球俱乐部', '国安', '#22c55e'),
  c: team('c', '山东泰山足球俱乐部', '泰山', '#f97316'),
  d: team('d', '上海申花足球俱乐部', '申花', '#3b82f6'),
};

const teamStates = Object.fromEntries(Object.keys(teamBases).map(id => [id, {
  id,
  leagueLevel: 1,
  morale: 60,
  fatigue: 10,
  momentum: 0,
  squadHealth: 90,
  coachPressure: 10,
  recentForm: [],
}])) as Record<string, TeamState>;

function fixture(id: string, round: number, roundName: string, homeTeamId: string, awayTeamId: string): CupFixture {
  return { id, round, roundName, homeTeamId, awayTeamId };
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(rounds: CupRound[], onClick: TieClickHandler = () => undefined) {
  act(() => root.render(
    <BracketView rounds={rounds} tb={teamBases} ts={teamStates} onClick={onClick} />,
  ));
}

const norm = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

describe('mobile cup bracket', () => {
  it('opens as a classic bracket and completes the visible route to the trophy', () => {
    const teamIds = ['a', 'b', 'c', 'd'];
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: false,
      fixtures: Array.from({ length: 16 }, (_, index) => (
        fixture(`f${index}`, 1, 'R32', teamIds[index % teamIds.length], teamIds[(index + 1) % teamIds.length])
      )),
    }]);

    expect(container.querySelector('[data-testid="classic-bracket"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-controls="cup-bracket-panel"]')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-bracket-round="32强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="16强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="八强"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="半决赛"]')).not.toBeNull();
    expect(container.querySelector('[data-bracket-round="决赛"]')).not.toBeNull();
    expect(container.textContent).toContain('冠军');
    expect(container.textContent).toContain('恒大');
    expect(container.textContent).not.toContain('广州恒大足球俱乐部');
  });

  it('keeps the compact round list as a persisted alternative', () => {
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: false,
      fixtures: [fixture('f1', 1, 'R32', 'a', 'b'), fixture('f2', 1, 'R32', 'c', 'd')],
    }]);

    const listTab = container.querySelector<HTMLButtonElement>('[aria-controls="cup-list-panel"]')!;
    act(() => listTab.click());
    const panel = container.querySelector<HTMLElement>('#cup-list-panel')!;
    expect(panel.querySelector('.grid-cols-2')).not.toBeNull();
    expect(panel.textContent).toContain('恒大');
    expect(panel.textContent).toContain('国安');
    expect(panel.textContent).not.toContain('广州恒大足球俱乐部');
    expect(panel.querySelectorAll('button.w-full')).toHaveLength(2);
    expect(localStorage.getItem('football-universe:cup-bracket-view-v1')).toBe('list');
  });

  it('opens the list on the first incomplete round and can inspect completed rounds', () => {
    localStorage.setItem('football-universe:cup-bracket-view-v1', 'list');
    render([
      {
        roundNumber: 1,
        roundName: 'R32',
        completed: true,
        fixtures: [fixture('f1', 1, 'R32', 'a', 'b')],
      },
      {
        roundNumber: 2,
        roundName: 'R16',
        completed: false,
        fixtures: [fixture('f2', 2, 'R16', 'c', 'd')],
      },
    ]);

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="杯赛轮次"] [role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    act(() => tabs[0].click());
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('恒大');
  });

  it('keeps an unfinished first leg grouped into its eventual two-legged tie', () => {
    const merged = buildMergedRounds([{
      roundNumber: 1,
      roundName: 'QF-L1',
      completed: false,
      fixtures: [fixture('qf-1', 1, 'QF-L1', 'a', 'b')],
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ label: '八强', twoLegged: true, completed: false });
    expect(merged[0].ties[0].leg2).toBeNull();
  });

  it('pairs reversed second legs by team identity and calculates aggregate scores', () => {
    const firstA = fixture('qf-a-1', 1, 'QF-L1', 'a', 'b');
    firstA.result = { home: 2, away: 1 };
    const firstB = fixture('qf-b-1', 1, 'QF-L1', 'c', 'd');
    firstB.result = { home: 0, away: 1 };
    const secondB = fixture('qf-b-2', 2, 'QF-L2', 'd', 'c');
    secondB.result = { home: 2, away: 2 };
    secondB.winnerId = 'd';
    const secondA = fixture('qf-a-2', 2, 'QF-L2', 'b', 'a');
    secondA.result = { home: 1, away: 3 };
    secondA.winnerId = 'a';

    const merged = buildMergedRounds([
      { roundNumber: 1, roundName: 'QF-L1', completed: true, fixtures: [firstA, firstB] },
      { roundNumber: 2, roundName: 'QF-L2', completed: true, fixtures: [secondB, secondA] },
    ]);

    expect(merged[0].ties[0]).toMatchObject({ leg2: secondA, agg1: 5, agg2: 2, winnerId: 'a' });
    expect(merged[0].ties[1]).toMatchObject({ leg2: secondB, agg1: 2, agg2: 3, winnerId: 'd' });
  });

  it('adds future rounds without inventing teams or fixtures', () => {
    const merged = buildMergedRounds([{
      roundNumber: 1,
      roundName: 'R16',
      completed: false,
      fixtures: Array.from({ length: 8 }, (_, index) => fixture(`r16-${index}`, 1, 'R16', 'a', 'b')),
    }]);
    const display = buildDisplayRounds(merged);

    expect(display.map(round => [round.label, round.ties.length])).toEqual([
      ['16强', 8],
      ['八强', 4],
      ['半决赛', 2],
      ['决赛', 1],
    ]);
    expect(display.slice(1).every(round => round.synthetic)).toBe(true);
    expect(display.slice(1).flatMap(round => round.ties).every(tie => tie.leg1 === null && tie.team1Id === '')).toBe(true);
  });
});

describe('super cup two-legged bracket', () => {
  const shortName = (id: string) => (teamBases as Record<string, TeamBase>)[id].shortName;

  /** Real super cup knockout shape: QF-L1/QF-L2/SF-L1/SF-L2/Final. */
  function superCupKnockout(): CupRound[] {
    const qf1Leg1 = fixture('SC-S3-QF-M1-L1', 1, 'QF', 'a', 'b');
    qf1Leg1.result = { home: 2, away: 1 };
    const qf1Leg2 = fixture('SC-S3-QF-M1-L2', 2, 'QF', 'b', 'a');
    qf1Leg2.result = { home: 1, away: 3 };
    qf1Leg2.winnerId = 'a';

    const qf2Leg1 = fixture('SC-S3-QF-M2-L1', 1, 'QF', 'c', 'd');
    qf2Leg1.result = { home: 1, away: 1 };
    const qf2Leg2 = fixture('SC-S3-QF-M2-L2', 2, 'QF', 'd', 'c');
    qf2Leg2.result = { home: 2, away: 2, extraTime: true, penalties: true, penHome: 3, penAway: 4 };
    qf2Leg2.winnerId = 'c';

    const sfLeg1 = fixture('SC-S3-SF-M1-L1', 3, 'SF', 'a', 'c');
    sfLeg1.result = { home: 0, away: 1 };
    const sfLeg2 = fixture('SC-S3-SF-M1-L2', 4, 'SF', 'c', 'a');
    sfLeg2.result = { home: 0, away: 2 };
    sfLeg2.winnerId = 'a';

    const final = fixture('SC-S3-Final-M1-L1', 5, 'Final', 'a', 'c');
    final.isNeutralVenue = true;
    final.result = { home: 2, away: 0 };
    final.winnerId = 'a';

    return [
      { roundNumber: 1, roundName: 'QF-L1', completed: true, fixtures: [qf1Leg1, qf2Leg1] },
      { roundNumber: 2, roundName: 'QF-L2', completed: true, fixtures: [qf1Leg2, qf2Leg2] },
      { roundNumber: 3, roundName: 'SF-L1', completed: true, fixtures: [sfLeg1] },
      { roundNumber: 4, roundName: 'SF-L2', completed: true, fixtures: [sfLeg2] },
      { roundNumber: 5, roundName: 'Final', completed: true, fixtures: [final] },
    ];
  }

  function tieCard(id: string): HTMLElement {
    const card = container.querySelector<HTMLElement>(`[data-tie-id="${id}"]`);
    expect(card, `找不到对阵卡片 ${id}`).not.toBeNull();
    return card!;
  }

  const legScore = (card: HTMLElement, leg: 1 | 2) =>
    norm(card.querySelector(`[data-testid="cup-tie-leg-${leg}-score"]`)?.textContent);

  it('prints every leg with both team names in that leg own home-away order', () => {
    const rounds = superCupKnockout();
    render(rounds);
    const card = tieCard('SC-S3-QF-M1-L1');
    const leg1 = rounds[0].fixtures[0];
    const leg2 = rounds[1].fixtures[0];

    // 由测试数据实算：每场按自己的主客顺序打印
    expect(legScore(card, 1)).toBe(
      `${shortName(leg1.homeTeamId)} ${leg1.result!.home}-${leg1.result!.away} ${shortName(leg1.awayTeamId)}`,
    );
    expect(legScore(card, 2)).toBe(
      `${shortName(leg2.homeTeamId)} ${leg2.result!.home}-${leg2.result!.away} ${shortName(leg2.awayTeamId)}`,
    );
    expect(legScore(card, 1)).toBe('恒大 2-1 国安');
    expect(legScore(card, 2)).toBe('国安 1-3 恒大');
  });

  it('never prints the second leg in the card row order', () => {
    render(superCupKnockout());
    const card = tieCard('SC-S3-QF-M1-L1');

    // 行序固定为 team1/team2（首回合主队在上）
    const rows = [...card.querySelectorAll('.cup-bracket-team-name')].map(node => norm(node.textContent));
    expect(rows).toEqual(['恒大', '国安']);

    // 次回合主队是 team2，所以次回合比分必须以 team2 开头，不能按行序打印
    const secondLeg = legScore(card, 2);
    expect(secondLeg.startsWith('国安')).toBe(true);
    expect(secondLeg).not.toBe('恒大 1-3 国安');
    expect(card.textContent).not.toContain('恒大 1-3 国安');
    expect(card.textContent).not.toContain('次 1-3');
  });

  it('names both sides in the shootout line and keeps it consistent with the advancing row', () => {
    const rounds = superCupKnockout();
    render(rounds);
    const card = tieCard('SC-S3-QF-M2-L1');
    const leg2 = rounds[1].fixtures[1];

    const shootout = norm(card.querySelector('[data-testid="cup-tie-leg-2-pens"]')?.textContent);
    expect(shootout).toBe(
      `点球(次回合后) ${shortName(leg2.homeTeamId)} ${leg2.result!.penHome}-${leg2.result!.penAway} ${shortName(leg2.awayTeamId)}`,
    );
    expect(shootout).toBe('点球(次回合后) 申花 3-4 泰山');
    expect(card.textContent).not.toContain('点球(次回合后) 泰山 3-4 申花');

    const [label, homeName, score, awayName] = shootout.split(' ');
    expect(label).toBe('点球(次回合后)');
    const [homePens, awayPens] = score.split('-').map(Number);
    const shootoutWinner = homePens > awayPens ? homeName : awayName;
    expect(shootoutWinner).toBe('泰山');

    const winnerRow = [...card.querySelectorAll('.cup-bracket-team')]
      .find(row => row.getAttribute('data-winner') === 'true');
    expect(winnerRow, '点球决出的胜方必须有晋级标记').toBeTruthy();
    expect(norm(winnerRow!.querySelector('.cup-bracket-team-name')?.textContent)).toBe(shootoutWinner);

    // 由点球决出时不应再显示客场进球
    expect(norm(card.querySelector('[data-testid="cup-tie-aggregate"]')?.textContent))
      .toBe('总比分 3-3 · 泰山晋级');
  });

  it('marks the leg that went to extra time', () => {
    render(superCupKnockout());

    const decided = tieCard('SC-S3-QF-M2-L1');
    expect(norm(decided.querySelector('[data-testid="cup-tie-leg-2-extra-time"]')?.textContent)).toBe('含加时');
    expect(decided.querySelector('[data-testid="cup-tie-leg-1-extra-time"]')).toBeNull();

    const clean = tieCard('SC-S3-QF-M1-L1');
    expect(clean.querySelector('[data-testid="cup-tie-leg-1-extra-time"]')).toBeNull();
    expect(clean.querySelector('[data-testid="cup-tie-leg-2-extra-time"]')).toBeNull();
    expect(clean.textContent).not.toContain('含加时');
  });

  it('shows the aggregate with the advancing team', () => {
    const rounds = superCupKnockout();
    render(rounds);
    const card = tieCard('SC-S3-QF-M1-L1');
    const leg1 = rounds[0].fixtures[0].result!;
    const leg2 = rounds[1].fixtures[0].result!;
    const agg1 = leg1.home + leg2.away;
    const agg2 = leg1.away + leg2.home;

    expect(agg1).toBe(5);
    expect(agg2).toBe(2);
    expect(norm(card.querySelector('[data-testid="cup-tie-aggregate"]')?.textContent))
      .toBe(`总比分 ${agg1}-${agg2} · ${shortName('a')}晋级`);
  });

  it('marks leg venues on two-legged ties only', () => {
    render(superCupKnockout());

    const card = tieCard('SC-S3-QF-M1-L1');
    const rows = [...card.querySelectorAll('.cup-bracket-team')];
    expect(rows).toHaveLength(2);
    expect(norm(rows[0].querySelector('.cup-bracket-team-name')?.textContent)).toBe('恒大');
    expect(norm(rows[0].querySelector('[data-testid="cup-venue-tag"]')?.textContent)).toBe('(首回合主场)');
    expect(norm(rows[1].querySelector('.cup-bracket-team-name')?.textContent)).toBe('国安');
    expect(norm(rows[1].querySelector('[data-testid="cup-venue-tag"]')?.textContent)).toBe('(次回合主场)');

    expect(tieCard('SC-S3-SF-M1-L1').querySelectorAll('[data-testid="cup-venue-tag"]')).toHaveLength(2);

    const final = tieCard('SC-S3-Final-M1-L1');
    expect(final.tagName).toBe('BUTTON');
    expect(final.querySelectorAll('[data-testid="cup-venue-tag"]')).toHaveLength(0);
    expect(final.querySelector('[data-testid="cup-tie-leg-1"]')).toBeNull();
    expect(final.querySelector('[data-testid="cup-tie-aggregate"]')).toBeNull();
  });

  it('leaves single-match cups free of venue markers and leg entries', () => {
    render([{
      roundNumber: 1,
      roundName: 'R32',
      completed: true,
      fixtures: [fixture('f1', 1, 'R32', 'a', 'b')],
    }]);

    expect(container.querySelectorAll('[data-testid="cup-venue-tag"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="cup-tie-leg-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="cup-tie-aggregate"]')).toBeNull();
  });

  it('opens each leg from its own entry in both bracket views', () => {
    const clicks: Array<{ id: string; leg?: number }> = [];
    const onClick: TieClickHandler = (fix, ctx) => { clicks.push({ id: fix.id, leg: ctx?.leg }); };

    render(superCupKnockout(), onClick);
    const card = tieCard('SC-S3-QF-M1-L1');
    act(() => card.querySelector<HTMLButtonElement>('[data-testid="cup-tie-leg-1"]')!.click());
    act(() => card.querySelector<HTMLButtonElement>('[data-testid="cup-tie-leg-2"]')!.click());
    expect(clicks).toEqual([
      { id: 'SC-S3-QF-M1-L1', leg: 1 },
      { id: 'SC-S3-QF-M1-L2', leg: 2 },
    ]);

    clicks.length = 0;
    const listTab = container.querySelector<HTMLButtonElement>('[aria-controls="cup-list-panel"]')!;
    act(() => listTab.click());
    const roundTabs = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="杯赛轮次"] [role="tab"]')];
    expect(roundTabs).toHaveLength(3);

    act(() => roundTabs[0].click());
    const listCard = container.querySelector<HTMLElement>('#cup-list-panel [data-tie-id="SC-S3-QF-M1-L1"]')!;
    act(() => listCard.querySelector<HTMLButtonElement>('[data-testid="cup-tie-leg-1"]')!.click());
    act(() => listCard.querySelector<HTMLButtonElement>('[data-testid="cup-tie-leg-2"]')!.click());
    expect(clicks).toEqual([
      { id: 'SC-S3-QF-M1-L1', leg: 1 },
      { id: 'SC-S3-QF-M1-L2', leg: 2 },
    ]);

    // 单回合卡片仍是单一入口，且不携带 leg
    clicks.length = 0;
    act(() => roundTabs[2].click());
    const finalCard = container.querySelector<HTMLButtonElement>('#cup-list-panel [data-tie-id="SC-S3-Final-M1-L1"]')!;
    expect(finalCard.querySelector('[data-testid="cup-tie-leg-1"]')).toBeNull();
    act(() => finalCard.click());
    expect(clicks).toEqual([{ id: 'SC-S3-Final-M1-L1', leg: undefined }]);
  });

  it('merges the real super cup round names and flags only the two-legged rounds', () => {
    const rounds = superCupKnockout();
    const merged = buildMergedRounds(rounds);
    expect(merged.map(round => [round.label, round.twoLegged])).toEqual([
      ['八强', true],
      ['半决赛', true],
      ['决赛', false],
    ]);

    render(rounds);
    const rendered = [...container.querySelectorAll('[data-bracket-round]')]
      .map(node => node.getAttribute('data-bracket-round'));
    expect(rendered).toEqual(['八强', '半决赛', '决赛']);

    const heading = (label: string) =>
      container.querySelector<HTMLElement>(`[data-bracket-round="${label}"] .cup-bracket-round-heading`)!;
    expect(heading('八强').textContent).toContain('两回合');
    expect(heading('半决赛').textContent).toContain('两回合');
    expect(heading('决赛').textContent).not.toContain('两回合');
  });
});

