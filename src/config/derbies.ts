import { TeamBase } from '../types/team';

export type DerbyType = 'summit' | 'focus' | 'regional';

export interface DerbyInfo {
  type: DerbyType;
  boost: number;
  label: string;
}

export function getDerbyInfo(
  teamAId: string,
  teamBId: string,
  teamBases: Record<string, TeamBase>,
): DerbyInfo | null {
  const a = teamBases[teamAId];
  const b = teamBases[teamBId];
  if (!a?.region || !b?.region) return null;

  const [continentA, subA] = a.region.split('+');
  const [continentB, subB] = b.region.split('+');
  const ovrDiff = Math.abs(a.overall - b.overall);
  const minOvr = Math.min(a.overall, b.overall);

  if (continentA !== continentB && minOvr >= 83 && ovrDiff <= 10) {
    return { type: 'summit', boost: 4, label: `${continentA}${continentB}巅峰对决` };
  }

  if (continentA === continentB && subA !== subB && minOvr >= 78 && ovrDiff <= 10) {
    return { type: 'focus', boost: 3, label: `${continentA}焦点德比` };
  }

  if (subA === subB) {
    return { type: 'regional', boost: 2, label: `${subA}德比` };
  }

  return null;
}

export function isDerby(homeId: string, awayId: string, teamBases?: Record<string, TeamBase>): boolean {
  if (!teamBases) return false;
  return getDerbyInfo(homeId, awayId, teamBases) !== null;
}

export function getDerbyName(homeId: string, awayId: string, teamBases?: Record<string, TeamBase>): string | null {
  if (!teamBases) return null;
  return getDerbyInfo(homeId, awayId, teamBases)?.label ?? null;
}

export function getDerbyBoost(homeId: string, awayId: string, teamBases: Record<string, TeamBase>): number {
  return getDerbyInfo(homeId, awayId, teamBases)?.boost ?? 0;
}
