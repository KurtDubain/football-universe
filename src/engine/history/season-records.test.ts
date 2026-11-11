import { describe, it, expect } from 'vitest';
import {
  bestRate,
  bestTotal,
  flattenSeasonRecords,
  describeHolders,
  RECORD_MIN_PLAYED,
  type SeasonRecordWithTeam,
} from './season-records';

function row(over: Partial<SeasonRecordWithTeam>): SeasonRecordWithTeam {
  return {
    seasonNumber: 1,
    leagueLevel: 1,
    leaguePosition: 1,
    leaguePlayed: 30,
    leagueWon: 20,
    leagueDrawn: 5,
    leagueLost: 5,
    leagueGF: 60,
    leagueGA: 20,
    leaguePoints: 65,
    coachId: 'c1',
    promoted: false,
    relegated: false,
    teamId: 'T1',
    teamName: 'Team One',
    ...over,
  };
}

describe('bestRate — ties', () => {
  it('returns every tied holder instead of one arbitrary winner', () => {
    const rows = [
      row({ teamId: 'A', teamName: 'Alpha', seasonNumber: 1, leagueWon: 19, leaguePlayed: 30 }),
      row({ teamId: 'B', teamName: 'Bravo', seasonNumber: 1, leagueWon: 19, leaguePlayed: 30 }),
      row({ teamId: 'C', teamName: 'Charlie', seasonNumber: 1, leagueWon: 18, leaguePlayed: 30 }),
    ];
    const result = bestRate(rows, r => r.leagueWon, 'max');
    expect(result).not.toBeNull();
    expect(result!.tied).toBe(true);
    expect(result!.holders.map(h => h.teamId).sort()).toEqual(['A', 'B']);
  });

  it('orders tied holders by season then teamId, not by input order', () => {
    const rows = [
      row({ teamId: 'Z', seasonNumber: 3, leagueWon: 19 }),
      row({ teamId: 'A', seasonNumber: 1, leagueWon: 19 }),
      row({ teamId: 'M', seasonNumber: 1, leagueWon: 19 }),
    ];
    const forward = bestRate(rows, r => r.leagueWon, 'max')!;
    const reversed = bestRate([...rows].reverse(), r => r.leagueWon, 'max')!;
    const expected = ['A', 'M', 'Z'];
    expect(forward.holders.map(h => h.teamId)).toEqual(expected);
    expect(reversed.holders.map(h => h.teamId)).toEqual(expected);
  });

  it('reports a single holder as untied', () => {
    const rows = [
      row({ teamId: 'A', leagueWon: 20 }),
      row({ teamId: 'B', leagueWon: 19 }),
    ];
    const result = bestRate(rows, r => r.leagueWon, 'max')!;
    expect(result.tied).toBe(false);
    expect(result.holders).toHaveLength(1);
    expect(result.holders[0].teamId).toBe('A');
  });
});

describe('bestRate — schedule fairness', () => {
  it('lets a short-schedule tier compete on rate, not raw total', () => {
    const rows = [
      // Top flight: 25 wins from 30 rounds = 0.833
      row({ teamId: 'TOP', leagueLevel: 1, leaguePlayed: 30, leagueWon: 25 }),
      // Tier 3: 13 wins from 14 rounds = 0.929 — better rate, fewer total wins
      row({ teamId: 'LOW', leagueLevel: 3, leaguePlayed: 14, leagueWon: 13 }),
    ];
    const byRate = bestRate(rows, r => r.leagueWon, 'max')!;
    expect(byRate.holders[0].teamId).toBe('LOW');

    // The old raw-total behaviour would have picked the top flight.
    const byTotal = bestTotal(rows, r => r.leagueWon, 'max')!;
    expect(byTotal.holders[0].teamId).toBe('TOP');
  });
});

describe('bestRate — eligibility (regression for the filter/reduce seed bug)', () => {
  it('never awards a record to a row below the minimum match count', () => {
    const rows = [
      // Short sample with an extreme rate — must be excluded entirely.
      row({ teamId: 'SHORT', leaguePlayed: 3, leagueWon: 3, leaguePoints: 9, leagueGA: 0 }),
      row({ teamId: 'REAL', leaguePlayed: 30, leagueWon: 20, leaguePoints: 65, leagueGA: 20 }),
    ];

    // The old code filtered to leaguePlayed > 5 but seeded the reduce with the
    // unfiltered first element, so SHORT could win every minimum record.
    const fewest = bestRate(rows, r => r.leaguePoints, 'min')!;
    expect(fewest.holders.map(h => h.teamId)).toEqual(['REAL']);

    const bestDef = bestRate(rows, r => r.leagueGA, 'min')!;
    expect(bestDef.holders.map(h => h.teamId)).toEqual(['REAL']);

    const mostWins = bestRate(rows, r => r.leagueWon, 'max')!;
    expect(mostWins.holders.map(h => h.teamId)).toEqual(['REAL']);
  });

  it('returns null when no row meets the minimum', () => {
    const rows = [row({ leaguePlayed: 3 }), row({ teamId: 'B', leaguePlayed: 4 })];
    expect(bestRate(rows, r => r.leagueWon, 'max')).toBeNull();
  });

  it('honours a custom minimum', () => {
    const rows = [
      row({ teamId: 'A', leaguePlayed: 14, leagueWon: 14 }),
      row({ teamId: 'B', leaguePlayed: 30, leagueWon: 28 }),
    ];
    const strict = bestRate(rows, r => r.leagueWon, 'max', 20)!;
    expect(strict.holders.map(h => h.teamId)).toEqual(['B']);
    const loose = bestRate(rows, r => r.leagueWon, 'max', 10)!;
    expect(loose.holders[0].teamId).toBe('A');
  });

  it('uses RECORD_MIN_PLAYED as the default gate', () => {
    expect(RECORD_MIN_PLAYED).toBe(10);
    const rows = [row({ teamId: 'JUST_UNDER', leaguePlayed: 9, leagueWon: 9 })];
    expect(bestRate(rows, r => r.leagueWon, 'max')).toBeNull();
  });
});

describe('bestRate — direction', () => {
  it('min picks the lowest rate', () => {
    const rows = [
      row({ teamId: 'A', leagueGA: 10 }),
      row({ teamId: 'B', leagueGA: 30 }),
    ];
    const result = bestRate(rows, r => r.leagueGA, 'min')!;
    expect(result.holders[0].teamId).toBe('A');
    expect(result.holders[0].value).toBeCloseTo(10 / 30, 10);
  });
});

describe('holder payload', () => {
  it('exposes raw total, played and level for display', () => {
    const rows = [row({ teamId: 'A', leagueLevel: 2, leaguePlayed: 14, leagueGF: 35 })];
    const result = bestRate(rows, r => r.leagueGF, 'max')!;
    const h = result.holders[0];
    expect(h.raw).toBe(35);
    expect(h.played).toBe(14);
    expect(h.leagueLevel).toBe(2);
    expect(h.value).toBeCloseTo(2.5, 10);
  });
});

describe('flattenSeasonRecords', () => {
  it('carries team identity onto every row', () => {
    const records = {
      T1: [row({ teamId: 'IGNORED', teamName: 'IGNORED', seasonNumber: 1 })],
      T2: [row({ teamId: 'IGNORED', teamName: 'IGNORED', seasonNumber: 2 })],
    };
    const flat = flattenSeasonRecords(records, id => `Name-${id}`);
    expect(flat).toHaveLength(2);
    expect(flat.map(r => r.teamId).sort()).toEqual(['T1', 'T2']);
    expect(flat.map(r => r.teamName).sort()).toEqual(['Name-T1', 'Name-T2']);
  });

  it('tolerates an empty record set', () => {
    expect(flattenSeasonRecords({}, id => id)).toEqual([]);
  });
});

describe('describeHolders', () => {
  it('renders a single holder by name', () => {
    const result = bestRate([row({ teamId: 'A', teamName: 'Alpha' })], r => r.leagueWon, 'max')!;
    expect(describeHolders(result)).toBe('Alpha');
  });

  it('summarises ties with a count', () => {
    const rows = [
      row({ teamId: 'A', teamName: 'Alpha', leagueWon: 19 }),
      row({ teamId: 'B', teamName: 'Bravo', leagueWon: 19 }),
    ];
    const result = bestRate(rows, r => r.leagueWon, 'max')!;
    expect(describeHolders(result)).toBe('Alpha 等 2 队');
  });

  it('renders a dash for a missing record', () => {
    expect(describeHolders(null)).toBe('—');
  });
});
