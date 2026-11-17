// Who the ground belongs to.
//
// A neutral final is not a home match with the labels swapped. The simulator
// already knows the difference: `isNeutralVenue` turns off home advantage and
// `tournamentHostTeamId` buys a separate slice of atmosphere. The picture did
// not, and went on hanging the home club tifo over the stand and mowing its
// crest into the centre circle at a World Cup final.
//
// Everything here is derived from those two flags. Nothing is invented.

export type SeatTone = 'home' | 'away' | 'neutral';

export interface VenueCrest {
  teamId?: string;
  shortName: string;
  color: string;
}

export interface VenueBanner {
  /** Which end of the stand the cloth hangs, looking at it from the pitch. */
  side: 'left' | 'right';
  crest: VenueCrest;
}

export interface VenueIdentity {
  /** One tone per seat block, left to right across the stand. */
  blocks: SeatTone[];
  /** Cloth hung over the stand. A club ground has one banner; a final has two. */
  banners: VenueBanner[];
  /** Painted into the centre circle. Only a club own ground carries one. */
  centreCrest: VenueCrest | null;
  /** Corner flag colour. Null is the neutral pale flag. */
  flagColor: string | null;
  /** True when the ground belongs to one of the two clubs playing on it. */
  homeGround: boolean;
}

export interface VenueIdentityInput {
  isNeutralVenue?: boolean;
  /** World Cup host. Buys atmosphere, not a home match. */
  hostTeamId?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeCrest: VenueCrest;
  awayCrest: VenueCrest;
  /** How many solid seat runs the stand is divided into. */
  seatBlocks: number;
}

/** A host reaches into the neutral band; without one the split is even. */
const HOST_BLOCKS = 5;
const OTHER_BLOCKS = 3;
const NEUTRAL_BAND = 1;

function run(tone: SeatTone, count: number): SeatTone[] {
  const out: SeatTone[] = [];
  for (let index = 0; index < count; index += 1) out.push(tone);
  return out;
}

export function venueIdentity(input: VenueIdentityInput): VenueIdentity {
  const { awayCrest, homeCrest, seatBlocks } = input;

  if (!input.isNeutralVenue) {
    return {
      blocks: run('home', seatBlocks),
      banners: [{ side: 'left', crest: homeCrest }],
      centreCrest: homeCrest,
      flagColor: homeCrest.color,
      homeGround: true,
    };
  }

  // A final is played in front of two sets of fans, so the stand carries both
  // colours with a neutral band between them. A host is at home in the only
  // sense the simulator grants it — atmosphere — so its bloc is the larger one.
  const hostIsHome = Boolean(input.hostTeamId) && input.hostTeamId === input.homeTeamId;
  const hostIsAway = Boolean(input.hostTeamId) && input.hostTeamId === input.awayTeamId;
  const hasHost = hostIsHome || hostIsAway;
  const evenShare = Math.max(1, Math.floor((seatBlocks - NEUTRAL_BAND) / 2));
  const awayBlocks = hasHost ? (hostIsAway ? HOST_BLOCKS : OTHER_BLOCKS) : evenShare;
  const homeBlocks = hasHost ? (hostIsHome ? HOST_BLOCKS : OTHER_BLOCKS) : evenShare;
  const neutralBlocks = Math.max(0, seatBlocks - awayBlocks - homeBlocks);

  return {
    blocks: [
      ...run('away', awayBlocks),
      ...run('neutral', neutralBlocks),
      ...run('home', homeBlocks),
    ],
    banners: [
      { side: 'left', crest: awayCrest },
      { side: 'right', crest: homeCrest },
    ],
    centreCrest: null,
    flagColor: null,
    homeGround: false,
  };
}

/**
 * Which club colour answers a goal.
 *
 * The frame used to wash in the home colour whoever scored, which is wrong on
 * any ground and has no meaning at all on a neutral one.
 */
export function celebrationColorFor(
  scoringHome: boolean | null,
  homeColor: string,
  awayColor: string,
): string | null {
  if (scoringHome === null) return null;
  return scoringHome ? homeColor : awayColor;
}
