import { describe, expect, it } from 'vitest';
import { celebrationColorFor, venueIdentity, type VenueCrest } from './venue-identity';

const HOME: VenueCrest = { teamId: 't-home', shortName: '大同', color: '#c0392b' };
const AWAY: VenueCrest = { teamId: 't-away', shortName: '红太阳', color: '#1e8449' };
const BLOCKS = 9;

function build(overrides: Partial<Parameters<typeof venueIdentity>[0]> = {}) {
  return venueIdentity({
    homeTeamId: 't-home',
    awayTeamId: 't-away',
    homeCrest: HOME,
    awayCrest: AWAY,
    seatBlocks: BLOCKS,
    ...overrides,
  });
}

describe('venueIdentity', () => {
  it('gives a club ground entirely to its club', () => {
    const venue = build();
    expect(venue.homeGround).toBe(true);
    expect(venue.blocks).toHaveLength(BLOCKS);
    expect(venue.blocks.every(tone => tone === 'home')).toBe(true);
    expect(venue.banners).toEqual([{ side: 'left', crest: HOME }]);
    expect(venue.centreCrest).toBe(HOME);
    expect(venue.flagColor).toBe(HOME.color);
  });

  it('splits a neutral final between both sets of fans', () => {
    const venue = build({ isNeutralVenue: true });
    expect(venue.homeGround).toBe(false);
    expect(venue.blocks).toHaveLength(BLOCKS);
    expect(venue.blocks.filter(tone => tone === 'away')).toHaveLength(4);
    expect(venue.blocks.filter(tone => tone === 'home')).toHaveLength(4);
    expect(venue.blocks.filter(tone => tone === 'neutral')).toHaveLength(1);
  });

  it('puts the neutral band between the two blocs', () => {
    const { blocks } = build({ isNeutralVenue: true });
    const neutralAt = blocks.indexOf('neutral');
    expect(neutralAt).toBeGreaterThan(0);
    expect(blocks.slice(0, neutralAt).every(tone => tone === 'away')).toBe(true);
    expect(blocks.slice(neutralAt + 1).every(tone => tone === 'home')).toBe(true);
  });

  it('hangs one banner per club on a neutral ground', () => {
    const venue = build({ isNeutralVenue: true });
    expect(venue.banners).toEqual([
      { side: 'left', crest: AWAY },
      { side: 'right', crest: HOME },
    ]);
  });

  it('leaves the centre circle and the corner flags neutral', () => {
    const venue = build({ isNeutralVenue: true });
    expect(venue.centreCrest).toBeNull();
    expect(venue.flagColor).toBeNull();
  });

  it('gives a host the larger bloc without granting it the ground', () => {
    const venue = build({ isNeutralVenue: true, hostTeamId: 't-home' });
    expect(venue.blocks.filter(tone => tone === 'home')).toHaveLength(5);
    expect(venue.blocks.filter(tone => tone === 'away')).toHaveLength(3);
    expect(venue.blocks).toHaveLength(BLOCKS);
    expect(venue.centreCrest).toBeNull();
    expect(venue.homeGround).toBe(false);
  });

  it('mirrors the host bloc when the away club is hosting', () => {
    const venue = build({ isNeutralVenue: true, hostTeamId: 't-away' });
    expect(venue.blocks.filter(tone => tone === 'away')).toHaveLength(5);
    expect(venue.blocks.filter(tone => tone === 'home')).toHaveLength(3);
  });

  it('ignores a host that is not one of the two clubs', () => {
    const venue = build({ isNeutralVenue: true, hostTeamId: 't-other' });
    expect(venue.blocks.filter(tone => tone === 'home')).toHaveLength(4);
    expect(venue.blocks.filter(tone => tone === 'away')).toHaveLength(4);
  });

  it('fills the stand exactly for any block count', () => {
    for (const seatBlocks of [4, 6, 9, 12, 15]) {
      const venue = build({ isNeutralVenue: true, seatBlocks });
      expect(venue.blocks).toHaveLength(seatBlocks);
    }
  });
});

describe('celebrationColorFor', () => {
  it('answers a goal in the scoring club colour', () => {
    expect(celebrationColorFor(true, '#111111', '#222222')).toBe('#111111');
    expect(celebrationColorFor(false, '#111111', '#222222')).toBe('#222222');
  });

  it('stays silent when nobody has scored', () => {
    expect(celebrationColorFor(null, '#111111', '#222222')).toBeNull();
  });
});
