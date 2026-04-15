export interface HonorRecord {
  seasonNumber: number;
  league1Champion: string;
  league2Champion: string;
  league3Champion: string;
  leagueCupWinner: string;
  superCupWinner: string;
  worldCupWinner?: string;
  promoted: { teamId: string; from: number; to: number }[];
  relegated: { teamId: string; from: number; to: number }[];
  coachChanges: { teamId: string; oldCoachId: string; newCoachId: string; reason: string }[];
}
