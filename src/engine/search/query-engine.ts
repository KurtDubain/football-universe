import { GameWorld } from '../season/season-manager';

export type SearchEntity = 'team' | 'player' | 'coach';

export interface TeamFilters {
  tier?: string[];        // ['elite', 'strong', ...]
  continent?: string[];   // ['大陆', '南洲', '东洲']
  leagueLevel?: (1 | 2 | 3)[];
  minOverall?: number;
  maxOverall?: number;
  /** Has won X+ league championships across history */
  minLeagueChampionships?: number;
  /** Has won any cup */
  hasCupTrophy?: boolean;
  /** Currently in top N of any league */
  currentlyTopN?: number;
}

export interface PlayerFilters {
  position?: ('GK' | 'DF' | 'MF' | 'FW')[];
  minRating?: number;
  maxRating?: number;
  minGoals?: number;
  minAssists?: number;
  minMarketValue?: number;
  maxAge?: number;
}

export interface CoachFilters {
  style?: string[];
  minTrophies?: number;
  /** Has managed N+ different teams */
  minTeamsManaged?: number;
}

export interface SearchQuery {
  entity: SearchEntity;
  team?: TeamFilters;
  player?: PlayerFilters;
  coach?: CoachFilters;
}

export interface TeamSearchResult {
  teamId: string;
  name: string;
  tier: string;
  region: string;
  leagueLevel: 1 | 2 | 3;
  overall: number;
  championships: number;
  cupTrophies: number;
  currentRank: number;
}

export interface PlayerSearchResult {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  position: string;
  rating: number;
  goals: number;
  assists: number;
  marketValue: number;
  age: number;
}

export interface CoachSearchResult {
  coachId: string;
  coachName: string;
  style: string;
  rating: number;
  trophies: number;
  teamsManaged: number;
  currentTeamId: string | null;
  currentTeamName: string | null;
}

export type SearchResult = TeamSearchResult | PlayerSearchResult | CoachSearchResult;

/**
 * Execute a search against the game world. No data is fetched —
 * everything is filtered in-memory.
 */
export function executeSearch(world: GameWorld, query: SearchQuery): SearchResult[] {
  switch (query.entity) {
    case 'team':
      return searchTeams(world, query.team ?? {});
    case 'player':
      return searchPlayers(world, query.player ?? {});
    case 'coach':
      return searchCoaches(world, query.coach ?? {});
  }
}

function searchTeams(world: GameWorld, f: TeamFilters): TeamSearchResult[] {
  const results: TeamSearchResult[] = [];

  for (const team of Object.values(world.teamBases)) {
    if (f.tier && !f.tier.includes(team.tier)) continue;
    const continent = team.region.split('+')[0];
    if (f.continent && !f.continent.includes(continent)) continue;
    const teamState = world.teamStates[team.id];
    if (!teamState) continue;
    if (f.leagueLevel && !f.leagueLevel.includes(teamState.leagueLevel)) continue;
    if (f.minOverall !== undefined && team.overall < f.minOverall) continue;
    if (f.maxOverall !== undefined && team.overall > f.maxOverall) continue;

    const trophies = world.teamTrophies[team.id] ?? [];
    const championships = trophies.filter((t) => t.type === 'league1').length;
    const cupTrophies = trophies.filter((t) => t.type !== 'league1' && t.type !== 'league2' && t.type !== 'league3').length;

    if (f.minLeagueChampionships !== undefined && championships < f.minLeagueChampionships) continue;
    if (f.hasCupTrophy && cupTrophies === 0) continue;

    const standings = teamState.leagueLevel === 1 ? world.league1Standings : teamState.leagueLevel === 2 ? world.league2Standings : world.league3Standings;
    const currentRank = standings.findIndex((s) => s.teamId === team.id) + 1;
    if (f.currentlyTopN !== undefined && (currentRank === 0 || currentRank > f.currentlyTopN)) continue;

    results.push({
      teamId: team.id,
      name: team.name,
      tier: team.tier,
      region: team.region,
      leagueLevel: teamState.leagueLevel,
      overall: team.overall,
      championships,
      cupTrophies,
      currentRank: currentRank || 99,
    });
  }
  results.sort((a, b) => b.overall - a.overall);
  return results;
}

function searchPlayers(world: GameWorld, f: PlayerFilters): PlayerSearchResult[] {
  const results: PlayerSearchResult[] = [];

  for (const [teamId, squad] of Object.entries(world.squads)) {
    for (const player of squad) {
      if (f.position && !f.position.includes(player.position)) continue;
      if (f.minRating !== undefined && player.rating < f.minRating) continue;
      if (f.maxRating !== undefined && player.rating > f.maxRating) continue;
      if (f.maxAge !== undefined && (player.age ?? 25) > f.maxAge) continue;
      if (f.minMarketValue !== undefined && (player.marketValue ?? 0) < f.minMarketValue) continue;

      const stats = world.playerStats[player.id];
      if (f.minGoals !== undefined && (stats?.goals ?? 0) < f.minGoals) continue;
      if (f.minAssists !== undefined && (stats?.assists ?? 0) < f.minAssists) continue;

      const teamName = world.teamBases[teamId]?.name ?? teamId;
      results.push({
        playerId: player.id,
        playerName: player.name ?? `${player.number}号`,
        teamId,
        teamName,
        position: player.position,
        rating: player.rating,
        goals: stats?.goals ?? 0,
        assists: stats?.assists ?? 0,
        marketValue: player.marketValue ?? 0,
        age: player.age ?? 25,
      });
    }
  }
  results.sort((a, b) => b.rating - a.rating);
  return results;
}

function searchCoaches(world: GameWorld, f: CoachFilters): CoachSearchResult[] {
  const results: CoachSearchResult[] = [];

  for (const coach of Object.values(world.coachBases)) {
    if (f.style && !f.style.includes(coach.style)) continue;

    const trophies = (world.coachTrophies[coach.id] ?? []).length;
    if (f.minTrophies !== undefined && trophies < f.minTrophies) continue;

    const career = world.coachCareers[coach.id] ?? [];
    const teamsManaged = new Set(career.map((c) => c.teamId)).size;
    if (f.minTeamsManaged !== undefined && teamsManaged < f.minTeamsManaged) continue;

    const cs = world.coachStates[coach.id];
    const currentTeamId = cs?.currentTeamId ?? null;
    const currentTeamName = currentTeamId ? world.teamBases[currentTeamId]?.name ?? null : null;

    results.push({
      coachId: coach.id,
      coachName: coach.name,
      style: coach.style,
      rating: coach.rating,
      trophies,
      teamsManaged,
      currentTeamId,
      currentTeamName,
    });
  }
  results.sort((a, b) => b.trophies - a.trophies || b.rating - a.rating);
  return results;
}
