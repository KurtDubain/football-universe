import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TeamBase } from '../types/team';
import TeamName from './TeamName';

const team: TeamBase = {
  id: 'shimazu',
  name: '岛津众城',
  shortName: '岛津',
  color: '#6B2D75',
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
  region: '东洲+测试',
};

describe('TeamName', () => {
  it('uses the complete short name in compact surfaces while retaining the full-name title', () => {
    const markup = renderToStaticMarkup(
      <TeamName teamId={team.id} teamBases={{ [team.id]: team }} link={false} compact />,
    );

    expect(markup).toContain('title="岛津众城"');
    expect(markup).toContain('class="whitespace-nowrap">岛津</span>');
    expect(markup).not.toContain('>岛津众城</span>');
  });

  it('keeps the full name on non-compact surfaces', () => {
    const markup = renderToStaticMarkup(
      <TeamName teamId={team.id} teamBases={{ [team.id]: team }} link={false} />,
    );

    expect(markup).toContain('class="truncate">岛津众城</span>');
  });
});
