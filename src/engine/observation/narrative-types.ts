import type { StorylineType } from '../season/storylines';

export type NarrativeSource =
  | 'observation_theme'
  | 'storyline'
  | 'focus_fixture'
  | 'window_signal'
  | 'player_highlight'
  | 'player_story'
  | 'coach_pressure'
  | 'coach_story'
  | 'transfer_rumor'
  | 'transfer'
  | 'competition'
  | 'record'
  | 'match_result'
  | 'news';

export type NarrativeSubjectType =
  | 'team'
  | 'player'
  | 'coach'
  | 'fixture'
  | 'competition'
  | 'world';

export type NarrativeVisualKind = 'stage' | 'rise' | 'fall' | 'legacy' | 'transfer';
export type NarrativeVisualLevel = 'signal' | 'chapter' | 'world_moment';
export type NarrativeEditorialState = 'new' | 'changed' | 'ongoing';

export interface NarrativeFact {
  /** Stable within one candidate so merged sources can retain unique facts. */
  key: string;
  label: string;
  detail: string;
  source: NarrativeSource;
}

export interface NarrativeDestination {
  key: string;
  label: string;
  to?: string;
  fixtureId?: string;
}

export interface NarrativeSourceReference {
  source: NarrativeSource;
  eventKey: string;
}

export interface NarrativeWeights {
  importance: number;
  relevance: number;
  continuity: number;
  historical: number;
}

/** Internal source-adapter shape. NarrativeWeights are never returned to UI. */
export interface NarrativeCandidate {
  id: string;
  arcKey: string;
  eventKey: string;
  source: NarrativeSource;
  sourceRefs?: NarrativeSourceReference[];
  subjectType: NarrativeSubjectType;
  subjectIds: string[];
  fixtureIds?: string[];
  seasonNumber: number;
  seasonPhase?: string;
  storylineType?: StorylineType;
  title: string;
  summary: string;
  causes?: NarrativeFact[];
  evidence?: NarrativeFact[];
  turningPoints?: NarrativeFact[];
  consequences?: NarrativeFact[];
  nextWatch?: string;
  destinations?: NarrativeDestination[];
  visualKind?: NarrativeVisualKind;
  /** Image eligibility is independent from the artwork family. */
  visualLevel?: NarrativeVisualLevel;
  /** Runtime-only tie-breaker for the most mature presentation of one arc. */
  presentationPriority?: number;
  fingerprint: string;
  changedAt: number;
  weights: NarrativeWeights;
  /** Slot A is rendered by ObservationThemePanel and must not be repeated. */
  reservedForObservationTheme?: boolean;
}

/** Presentation-safe shape: internal ranking weights are deliberately absent. */
export type NarrativeItem = Omit<
  NarrativeCandidate,
  'weights' | 'reservedForObservationTheme' | 'presentationPriority' | 'visualLevel'
> & {
  visualLevel: NarrativeVisualLevel;
  editorialState: NarrativeEditorialState;
};

export interface NarrativeDigest {
  feature?: NarrativeItem;
  /** At most one historically meaningful image candidate for post-advance UI. */
  worldMoment?: NarrativeItem;
  signals: NarrativeItem[];
  more: NarrativeItem[];
  /** Fixtures merged into Slot A receive a relation badge instead of repeated copy. */
  observationRelationFixtureIds: string[];
  candidateCount: number;
}

export interface NarrativeMemoryEntry {
  arcKey: string;
  fingerprint: string;
  lastChangedAt: number;
  lastSelectedAt: number;
}

export interface NarrativeSelectionContext {
  elapsedWindow: number;
  favoriteTeamIds?: readonly string[];
  favoritePlayerIds?: readonly string[];
}
