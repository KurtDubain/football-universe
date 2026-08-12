// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyPlayerStat, playerTeamStatKey } from '../engine/players/stats';
import { initializeGameWorld } from '../engine/season/season-manager';
import SeasonNarrativeOverview from './SeasonNarrativeOverview';

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

describe('SeasonNarrativeOverview', () => {
  it('shows observed-team trajectory, a meaningful watched-player change, and canonical links', () => {
    const world = initializeGameWorld(20260822);
    const teamId = world.league1Standings[0].teamId;
    const player = world.squads[teamId][0];
    Object.assign(world.league1Standings[0], { played: 10, won: 7, drawn: 2, lost: 1, points: 23 });
    const stats = {
      ...emptyPlayerStat(player.uuid, teamId),
      appearances: 10,
      starts: 10,
      minutesPlayed: 900,
      teamMatchesAllCompetitions: 10,
      goals: 8,
      assists: 3,
      bigChances: 11,
      keyPasses: 5,
    };
    world.playerStats[player.uuid] = stats;
    world.playerStatSegments = { [playerTeamStatKey(player.uuid, teamId)]: stats };

    act(() => root.render(
      <MemoryRouter>
        <SeasonNarrativeOverview world={world} primaryTeamId={teamId} favoritePlayerIds={[player.uuid]} />
      </MemoryRouter>,
    ));

    expect(container.querySelector('[data-testid="season-narrative-overview"]')).not.toBeNull();
    expect(container.textContent).toContain('赛季版图');
    expect(container.textContent).toContain(world.teamBases[teamId].shortName);
    expect(container.textContent).toContain(player.name);
    expect(container.querySelector(`a[href="/team/${teamId}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/player/${player.uuid}"]`)).not.toBeNull();
  });

  it('renders nothing when there is no sustained season context', () => {
    const world = initializeGameWorld(20260823);
    act(() => root.render(
      <MemoryRouter>
        <SeasonNarrativeOverview world={world} primaryTeamId={null} favoritePlayerIds={[]} />
      </MemoryRouter>,
    ));
    expect(container.innerHTML).toBe('');
  });
});
