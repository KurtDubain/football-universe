import type { CompetitionType } from '../../types/match';
import leagueArtwork from '../../assets/visual/key-match-opener-v1.webp';
import domesticCupArtwork from '../../assets/visual/match-opener-domestic-cup-v1.webp';
import continentalArtwork from '../../assets/visual/match-opener-continental-v1.webp';
import worldArtwork from '../../assets/visual/match-opener-world-v1.webp';

export type MatchOpenerKind = 'league' | 'domestic_cup' | 'continental' | 'world';

const ARTWORK_BY_KIND: Readonly<Record<MatchOpenerKind, string>> = {
  league: leagueArtwork,
  domestic_cup: domesticCupArtwork,
  continental: continentalArtwork,
  world: worldArtwork,
};

export function matchOpenerKindForCompetition(competitionType: CompetitionType): MatchOpenerKind {
  if (competitionType === 'world_cup' || competitionType === 'world_cup_group') return 'world';
  if (competitionType === 'continental_cup') return 'continental';
  if (
    competitionType === 'league_cup'
    || competitionType === 'super_cup'
    || competitionType === 'super_cup_group'
    || competitionType === 'relegation_playoff'
  ) return 'domestic_cup';
  return 'league';
}

export function matchOpenerArtworkForCompetition(competitionType: CompetitionType): string {
  return ARTWORK_BY_KIND[matchOpenerKindForCompetition(competitionType)];
}

export function matchOpenerLabel(
  competitionType: CompetitionType,
  final: boolean,
): string {
  if (final) return '决赛现场 · 比分未揭晓';
  const kind = matchOpenerKindForCompetition(competitionType);
  if (kind === 'world') return '环球赛场 · 比分未揭晓';
  if (kind === 'continental') return '洲际之夜 · 比分未揭晓';
  if (kind === 'domestic_cup') return '杯赛之夜 · 比分未揭晓';
  return '焦点观战 · 比分未揭晓';
}
