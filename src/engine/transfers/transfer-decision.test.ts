import { describe, expect, it } from 'vitest';
import type { Player } from '../../types/player';
import type { TeamBase } from '../../types/team';
import { SeededRNG } from '../match/rng';
import {
  assessSquadNeeds,
  counterAcceptanceProbability,
  deriveRecruitmentProfile,
  estimateFreeAgentSigningCost,
  estimateTransferValue,
  scoreTransferFit,
  sellerAcceptanceProbability,
  weightedPick,
} from './transfer-decision';

function player(uuid: string, position: Player['position'], rating: number, age = 26): Player {
  return {
    uuid,
    teamId: 'team',
    name: uuid,
    number: Number(uuid.replace(/\D/g, '')) || 1,
    position,
    rating,
    goalScoring: 50,
    marketValue: Math.max(2, rating - 50),
    age,
    peakRating: rating + (age <= 22 ? 7 : 0),
    peakAge: 27,
  };
}

function team(id: string, reputation = 80): TeamBase {
  return {
    id,
    name: id,
    shortName: id,
    color: '#000',
    tier: 'strong',
    overall: 80,
    attack: 80,
    midfield: 80,
    defense: 80,
    stability: 80,
    depth: 80,
    reputation,
    initialLeagueLevel: 1,
    expectation: 4,
    region: '测试',
  };
}

const balancedSquad = [
  ...Array.from({ length: 3 }, (_, index) => player(`gk-${index}`, 'GK', 78 - index)),
  ...Array.from({ length: 7 }, (_, index) => player(`df-${index}`, 'DF', 80 - index)),
  ...Array.from({ length: 7 }, (_, index) => player(`mf-${index}`, 'MF', 81 - index)),
  ...Array.from({ length: 5 }, (_, index) => player(`fw-${index}`, 'FW', 82 - index)),
];

describe('transfer decision model', () => {
  it('gives each club a stable lightweight recruitment identity', () => {
    expect(deriveRecruitmentProfile('gz_hengda')).toBe(deriveRecruitmentProfile('gz_hengda'));
    const profiles = new Set(['gz_hengda', 'shimazu', 'xibei_wolf', 'liaoning', 'osaka'].map(deriveRecruitmentProfile));
    expect(profiles.size).toBeGreaterThan(1);
  });

  it('raises positional need for a genuine squad shortage', () => {
    const withoutForwards = balancedSquad.filter((candidate) => candidate.position !== 'FW');
    const needs = assessSquadNeeds(withoutForwards);
    expect(needs.FW.needScore).toBeGreaterThan(needs.DF.needScore);
    expect(needs.FW.count).toBe(0);
  });

  it('scores a needed tactical upgrade above an unnecessary downgrade', () => {
    const striker = player('target-9', 'FW', 88, 22);
    const needed = scoreTransferFit({
      player: striker,
      buyerSquad: balancedSquad.map((candidate) => candidate.position === 'FW' ? { ...candidate, rating: candidate.rating - 15 } : candidate),
      buyer: team('buyer'),
      seller: team('seller', 65),
      coachStyle: 'attacking',
      availableCash: 100,
      expectedFee: 40,
    });
    const downgrade = scoreTransferFit({
      player: player('target-10', 'DF', 60, 32),
      buyerSquad: balancedSquad,
      buyer: team('buyer'),
      seller: team('seller', 65),
      coachStyle: 'attacking',
      availableCash: 100,
      expectedFee: 10,
    });
    expect(needed.weight).toBeGreaterThan(downgrade.weight);
    expect(downgrade.weight).toBe(0);
  });

  it('anchors asking value to market value and seller leverage', () => {
    const star = { ...player('star-9', 'FW', 88), marketValue: 60 };
    const keyValue = estimateTransferValue({ player: star, sellerSquad: [star, ...balancedSquad.filter(p => p.position !== 'FW')], sellerCash: 200 });
    const urgentValue = estimateTransferValue({ player: star, sellerSquad: [...balancedSquad, star], sellerCash: -10 });
    expect(keyValue).toBeGreaterThan(60);
    expect(keyValue).toBeGreaterThan(urgentValue);
  });

  it('charges stronger free agents a larger signing premium', () => {
    const fringe = { ...player('free-1', 'MF', 62, 31), marketValue: 4 };
    const star = { ...player('free-2', 'MF', 86, 24), marketValue: 55 };
    expect(estimateFreeAgentSigningCost(star)).toBeGreaterThan(estimateFreeAgentSigningCost(fringe));
    expect(estimateFreeAgentSigningCost(star)).toBeLessThanOrEqual(25);
  });

  it('makes bid acceptance continuous without giving absurd low bids a large chance', () => {
    const veryLow = sellerAcceptanceProbability({ bid: 10, askingValue: 80, sellerCash: 80, keyPlayer: true });
    const nearAsk = sellerAcceptanceProbability({ bid: 76, askingValue: 80, sellerCash: 80, keyPlayer: false });
    const premium = sellerAcceptanceProbability({ bid: 96, askingValue: 80, sellerCash: 80, keyPlayer: false });
    expect(veryLow).toBeLessThanOrEqual(0.02);
    expect(nearAsk).toBeGreaterThan(veryLow);
    expect(premium).toBeGreaterThan(nearAsk);
  });

  it('rejects unaffordable counters and keeps weighted randomness deterministic', () => {
    expect(counterAcceptanceProbability({ counterFee: 60, buyerValuation: 70, buyerCash: 50, needScore: 1 })).toBe(0);
    const items = [{ id: 'need', weight: 8 }, { id: 'possible', weight: 2 }];
    const first = weightedPick(items, item => item.weight, new SeededRNG(42));
    const second = weightedPick(items, item => item.weight, new SeededRNG(42));
    expect(first).toEqual(second);
  });
});
