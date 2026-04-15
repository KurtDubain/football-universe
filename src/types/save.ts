export interface GameState {
  version: number;
  seed: number;
  seasonNumber: number;
  rngState: number;
  // all the other state is composed from the store
}
