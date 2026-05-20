/**
 * v8 → v9 migration tests for `backfillStaleHistoryPlayerIds`.
 *
 * The v8 migration only rewrote `playerId` values that matched a player's
 * CURRENT `${teamId}-${number}`. Historical entries produced before the player
 * transferred kept their FORMER legacy id, so the link rendered as
 * "未找到球员: jeonbuk-75". v9 walks `transferHistory` / `playerAwardsHistory`
 * and resolves those stale ids by name + team lookup.
 */
import { describe, it, expect } from 'vitest';
import { backfillStaleHistoryPlayerIds } from './game-store';

type TestPlayer = { uuid: string; name: string };
type TestWorld = Parameters<typeof backfillStaleHistoryPlayerIds>[0];

function makeWorld(squads: Record<string, TestPlayer[]>): TestWorld {
  return {
    squads,
    transferHistory: [],
    playerAwardsHistory: [],
  };
}

describe('backfillStaleHistoryPlayerIds (v8 → v9)', () => {
  it('repairs a stale transferHistory.playerId via (name, toTeamId)', () => {
    // Player 尹景元 originally at jeonbuk, then moved to gz_hengda, then to
    // bj_guoan — squads only have him at his CURRENT team. The old transfer
    // record kept "jeonbuk-75" as the playerId, which no longer resolves.
    const world = makeWorld({
      bj_guoan: [{ uuid: 'p-999', name: '尹景元' }],
      other: [{ uuid: 'p-1', name: '张三' }],
    });
    world.transferHistory!.push({
      playerId: 'jeonbuk-75',
      playerName: '尹景元',
      toTeamId: 'gz_hengda', // his destination at the time of THIS record
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    // gz_hengda no longer has him — falls through to name-only lookup,
    // which finds him at bj_guoan.
    expect(world.transferHistory![0].playerId).toBe('p-999');
    expect(tally.transfers).toBe(1);
    expect(tally.awards).toBe(0);
  });

  it('prefers (name, teamId) match over name-only when both are present', () => {
    // Two players with the same name on different teams — only the (name,
    // teamId) lookup can pick the right one.
    const world = makeWorld({
      teamA: [{ uuid: 'p-A', name: '李四' }],
      teamB: [{ uuid: 'p-B', name: '李四' }],
    });
    world.transferHistory!.push({
      playerId: 'someoldid-7',
      playerName: '李四',
      toTeamId: 'teamA',
    });

    backfillStaleHistoryPlayerIds(world);
    expect(world.transferHistory![0].playerId).toBe('p-A');
  });

  it('repairs a stale playerAwardsHistory.playerId via (name, teamId)', () => {
    const world = makeWorld({
      sy_street: [{ uuid: 'p-77', name: '蔡国栋' }],
    });
    world.playerAwardsHistory!.push({
      playerId: 'sy_street-5', // stale legacy shape
      playerName: '蔡国栋',
      teamId: 'sy_street',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.playerAwardsHistory![0].playerId).toBe('p-77');
    expect(tally.awards).toBe(1);
  });

  it('leaves uuid-shaped playerIds alone (idempotent on already-migrated saves)', () => {
    const world = makeWorld({
      teamA: [{ uuid: 'p-42', name: '王五' }],
    });
    world.transferHistory!.push({
      playerId: 'p-42', // already a uuid
      playerName: '王五',
      toTeamId: 'teamA',
    });
    world.playerAwardsHistory!.push({
      playerId: 'p-42',
      playerName: '王五',
      teamId: 'teamA',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.transferHistory![0].playerId).toBe('p-42');
    expect(world.playerAwardsHistory![0].playerId).toBe('p-42');
    expect(tally.transfers).toBe(0);
    expect(tally.awards).toBe(0);

    // Running it again is a no-op as well.
    const tally2 = backfillStaleHistoryPlayerIds(world);
    expect(tally2.transfers).toBe(0);
    expect(tally2.awards).toBe(0);
  });

  it('leaves unresolvable entries as-is and does not crash', () => {
    // Player no longer in any squad (e.g. retired). The UI's missing-player
    // fallback still applies — we just don't make things worse.
    const world = makeWorld({
      teamA: [{ uuid: 'p-1', name: '陈六' }],
    });
    world.transferHistory!.push({
      playerId: 'oldteam-99',
      playerName: '某退役球员',
      toTeamId: 'someplace',
    });
    world.playerAwardsHistory!.push({
      playerId: 'oldteam-50',
      playerName: '另一个失踪球员',
      teamId: 'oldteam',
    });

    const tally = backfillStaleHistoryPlayerIds(world);

    expect(world.transferHistory![0].playerId).toBe('oldteam-99');
    expect(world.playerAwardsHistory![0].playerId).toBe('oldteam-50');
    expect(tally.transfers).toBe(0);
    expect(tally.awards).toBe(0);
  });

  it('tolerates missing optional fields (no transferHistory, no name)', () => {
    const world: TestWorld = {
      squads: { teamA: [{ uuid: 'p-1', name: '黄七' }] },
      // intentionally no transferHistory / playerAwardsHistory
    };
    expect(() => backfillStaleHistoryPlayerIds(world)).not.toThrow();
  });

  it('reproduces the real-save audit numbers (16 transfers, 1 award)', () => {
    // Mirrors the audit on /Users/mutu/Downloads/football-universe-s16.json:
    // 16 stale transfer entries, 1 stale award entry. Constructed
    // synthetically so the test doesn't depend on the file existing.
    const squads: Record<string, TestPlayer[]> = {
      currentTeam: [],
    };
    const transferHistory: Array<{ playerId?: string; playerName?: string; toTeamId?: string }> = [];
    const playerAwardsHistory: Array<{ playerId?: string; playerName?: string; teamId?: string }> = [];
    for (let i = 0; i < 16; i++) {
      const name = `球员${i}`;
      squads.currentTeam.push({ uuid: `p-${i}`, name });
      transferHistory.push({
        playerId: `oldteam-${i}`,
        playerName: name,
        toTeamId: 'somewhere', // intentionally not their current team
      });
    }
    // Plus 28 already-uuid transfers (44 total to match the audit denominator)
    for (let i = 0; i < 28; i++) {
      transferHistory.push({
        playerId: `p-${i}`,
        playerName: `球员${i}`,
        toTeamId: 'currentTeam',
      });
    }
    // 1 stale award + 59 already-uuid awards
    squads.currentTeam.push({ uuid: 'p-award', name: '奖项球员' });
    playerAwardsHistory.push({
      playerId: 'oldteam-award',
      playerName: '奖项球员',
      teamId: 'someoldteam',
    });
    for (let i = 0; i < 59; i++) {
      playerAwardsHistory.push({
        playerId: `p-${i}`,
        playerName: `球员${i}`,
        teamId: 'currentTeam',
      });
    }

    const world: TestWorld = { squads, transferHistory, playerAwardsHistory };
    const tally = backfillStaleHistoryPlayerIds(world);

    expect(tally.transfers).toBe(16);
    expect(tally.awards).toBe(1);
  });
});
