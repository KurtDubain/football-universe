import type {
  NarrativeCandidate,
  NarrativeDestination,
  NarrativeDigest,
  NarrativeEditorialState,
  NarrativeFact,
  NarrativeItem,
  NarrativeMemoryEntry,
  NarrativeSelectionContext,
  NarrativeSource,
  NarrativeSourceReference,
} from './narrative-types';

export const MAX_NARRATIVE_MEMORY = 32;
export const MAX_NARRATIVE_SIGNALS = 2;
export const MAX_MORE_NARRATIVES = 6;
export const NARRATIVE_FEATURE_THRESHOLD = 58;
export const NARRATIVE_SIGNAL_THRESHOLD = 34;

const SOURCE_AUTHORITY: Record<NarrativeSource, number> = {
  match_result: 100,
  storyline: 90,
  record: 88,
  transfer: 86,
  observation_theme: 85,
  player_story: 82,
  coach_story: 82,
  focus_fixture: 80,
  player_highlight: 78,
  coach_pressure: 75,
  transfer_rumor: 70,
  competition: 68,
  window_signal: 65,
  news: 40,
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function uniqueByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function createNarrativeFingerprint(parts: readonly unknown[]): string {
  const input = parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join('|');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function mergeFacts(
  preferred: readonly NarrativeFact[] | undefined,
  secondary: readonly NarrativeFact[] | undefined,
): NarrativeFact[] {
  return uniqueByKey([...(preferred ?? []), ...(secondary ?? [])], fact => fact.key)
    .map(fact => ({ ...fact }));
}

function mergeDestinations(
  preferred: readonly NarrativeDestination[] | undefined,
  secondary: readonly NarrativeDestination[] | undefined,
): NarrativeDestination[] {
  return uniqueByKey(
    [...(preferred ?? []), ...(secondary ?? [])],
    destination => destination.key,
  ).map(destination => ({ ...destination }));
}

function sourceReferences(candidate: NarrativeCandidate): NarrativeSourceReference[] {
  return candidate.sourceRefs?.length
    ? candidate.sourceRefs.map(reference => ({ ...reference }))
    : [{ source: candidate.source, eventKey: candidate.eventKey }];
}

function phasePriority(phase: string | undefined): number {
  if (!phase) return 0;
  if (phase.includes('落幕') || phase.includes('冠军')) return 100;
  if (phase.includes('高潮') || phase.includes('决赛')) return 90;
  if (
    phase.includes('回应')
    || phase.includes('反弹')
    || phase.includes('连续')
    || phase.includes('落定')
  ) return 80;
  if (phase.includes('发展') || phase.includes('追逐') || phase.includes('高压')) return 70;
  if (phase.includes('新星') || phase.includes('回升') || phase.includes('更替')) return 60;
  if (phase.includes('开端')) return 50;
  return 20;
}

/** Positive means left is the stronger display representation of the same arc. */
function comparePresentation(left: NarrativeCandidate, right: NarrativeCandidate): number {
  return SOURCE_AUTHORITY[left.source] - SOURCE_AUTHORITY[right.source]
    || (left.presentationPriority ?? 0) - (right.presentationPriority ?? 0)
    || phasePriority(left.seasonPhase) - phasePriority(right.seasonPhase)
    || left.changedAt - right.changedAt
    || left.weights.importance - right.weights.importance
    || left.weights.historical - right.weights.historical
    || right.id.localeCompare(left.id);
}

function mergeCandidatePair(
  left: NarrativeCandidate,
  right: NarrativeCandidate,
): NarrativeCandidate {
  const preferred = comparePresentation(right, left) > 0 ? right : left;
  const secondary = preferred === left ? right : left;
  const sourceRefs = uniqueByKey(
    [...sourceReferences(preferred), ...sourceReferences(secondary)],
    reference => `${reference.source}:${reference.eventKey}`,
  );
  const componentFingerprints = [left.fingerprint, right.fingerprint].sort();

  return {
    ...preferred,
    id: [left.id, right.id].sort()[0],
    eventKey: [left.eventKey, right.eventKey].sort()[0],
    sourceRefs,
    subjectIds: [...new Set([...left.subjectIds, ...right.subjectIds])].sort(),
    fixtureIds: [...new Set([...(left.fixtureIds ?? []), ...(right.fixtureIds ?? [])])].sort(),
    causes: mergeFacts(preferred.causes, secondary.causes),
    evidence: mergeFacts(preferred.evidence, secondary.evidence),
    turningPoints: mergeFacts(preferred.turningPoints, secondary.turningPoints),
    consequences: mergeFacts(preferred.consequences, secondary.consequences),
    destinations: mergeDestinations(preferred.destinations, secondary.destinations),
    nextWatch: preferred.nextWatch ?? secondary.nextWatch,
    visualKind: preferred.visualKind ?? secondary.visualKind,
    visualLevel: preferred.visualLevel ?? 'signal',
    presentationPriority: preferred.presentationPriority,
    storylineType: preferred.storylineType ?? secondary.storylineType,
    seasonPhase: preferred.seasonPhase ?? secondary.seasonPhase,
    fingerprint: createNarrativeFingerprint(componentFingerprints),
    changedAt: Math.max(left.changedAt, right.changedAt),
    weights: {
      importance: Math.max(left.weights.importance, right.weights.importance),
      relevance: Math.max(left.weights.relevance, right.weights.relevance),
      continuity: Math.max(left.weights.continuity, right.weights.continuity),
      historical: Math.max(left.weights.historical, right.weights.historical),
    },
    reservedForObservationTheme: Boolean(
      left.reservedForObservationTheme || right.reservedForObservationTheme
    ),
  };
}

/** Merge only on stable structured arc identity. Display text never participates. */
export function mergeNarrativeCandidates(
  candidates: readonly NarrativeCandidate[],
): NarrativeCandidate[] {
  const merged = new Map<string, NarrativeCandidate>();
  for (const candidate of candidates) {
    const semanticKey = `${candidate.seasonNumber}:${candidate.arcKey}`;
    const existing = merged.get(semanticKey);
    const cloned: NarrativeCandidate = {
      ...candidate,
      sourceRefs: sourceReferences(candidate),
      subjectIds: [...candidate.subjectIds],
      fixtureIds: [...(candidate.fixtureIds ?? [])],
      causes: mergeFacts(candidate.causes, []),
      evidence: mergeFacts(candidate.evidence, []),
      turningPoints: mergeFacts(candidate.turningPoints, []),
      consequences: mergeFacts(candidate.consequences, []),
      destinations: mergeDestinations(candidate.destinations, []),
      weights: { ...candidate.weights },
    };
    merged.set(semanticKey, existing ? mergeCandidatePair(existing, cloned) : cloned);
  }
  return [...merged.values()];
}

function noveltyScore(
  candidate: NarrativeCandidate,
  memory: readonly NarrativeMemoryEntry[],
  elapsedWindow: number,
): number {
  const prior = memory.find(entry => entry.arcKey === candidate.arcKey);
  if (!prior) return 100;
  if (prior.fingerprint !== candidate.fingerprint) return 92;
  const sinceSelection = Math.max(0, elapsedWindow - prior.lastSelectedAt);
  if (sinceSelection <= 1) return 8;
  if (sinceSelection <= 3) return 24;
  if (sinceSelection <= 8) return 46;
  return 72;
}

function contextualRelevance(
  candidate: NarrativeCandidate,
  context: NarrativeSelectionContext,
): number {
  const favoriteTeams = new Set(context.favoriteTeamIds ?? []);
  const favoritePlayers = new Set(context.favoritePlayerIds ?? []);
  const favoriteTeamHit = candidate.subjectIds.some(id => favoriteTeams.has(id));
  const favoritePlayerHit = candidate.subjectIds.some(id => favoritePlayers.has(id));
  return clampScore(candidate.weights.relevance + (favoriteTeamHit ? 22 : 0) + (favoritePlayerHit ? 26 : 0));
}

function candidateScore(
  candidate: NarrativeCandidate,
  memory: readonly NarrativeMemoryEntry[],
  context: NarrativeSelectionContext,
): number {
  const relevance = contextualRelevance(candidate, context);
  const novelty = noveltyScore(candidate, memory, context.elapsedWindow);
  return clampScore(candidate.weights.importance) * 0.35
    + relevance * 0.25
    + novelty * 0.18
    + clampScore(candidate.weights.continuity) * 0.12
    + clampScore(candidate.weights.historical) * 0.10;
}

function editorialState(
  candidate: NarrativeCandidate,
  memory: readonly NarrativeMemoryEntry[],
): NarrativeEditorialState {
  const prior = memory.find(entry => entry.arcKey === candidate.arcKey);
  if (!prior) return 'new';
  return prior.fingerprint === candidate.fingerprint ? 'ongoing' : 'changed';
}

function toNarrativeItem(
  candidate: NarrativeCandidate,
  memory: readonly NarrativeMemoryEntry[],
): NarrativeItem {
  const {
    weights: _weights,
    reservedForObservationTheme: _reserved,
    presentationPriority: _presentationPriority,
    visualLevel,
    ...item
  } = candidate;
  void _weights;
  void _reserved;
  void _presentationPriority;
  return {
    ...item,
    visualLevel: visualLevel ?? 'signal',
    editorialState: editorialState(candidate, memory),
  };
}

function isRecentlyUnchanged(
  candidate: NarrativeCandidate,
  memory: readonly NarrativeMemoryEntry[],
  elapsedWindow: number,
): boolean {
  const prior = memory.find(entry => entry.arcKey === candidate.arcKey);
  return Boolean(
    prior
    && prior.fingerprint === candidate.fingerprint
    && elapsedWindow - prior.lastSelectedAt <= 3
  );
}

export function directNarrative(
  candidates: readonly NarrativeCandidate[],
  memory: readonly NarrativeMemoryEntry[],
  context: NarrativeSelectionContext,
): NarrativeDigest {
  const merged = mergeNarrativeCandidates(candidates);
  const reserved = merged.filter(candidate => candidate.reservedForObservationTheme);
  const selectable = merged.filter(candidate => !candidate.reservedForObservationTheme);
  const ranked = selectable
    .map(candidate => ({ candidate, score: candidateScore(candidate, memory, context) }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const featureEntry = ranked.find(entry => (
    entry.score >= NARRATIVE_FEATURE_THRESHOLD
    || (
      entry.candidate.weights.historical >= 90
      && entry.candidate.weights.importance >= 55
    )
  ));
  const signalEntries = ranked
    .filter(entry => entry !== featureEntry && entry.score >= NARRATIVE_SIGNAL_THRESHOLD)
    .slice(0, MAX_NARRATIVE_SIGNALS);
  const worldMomentEntry = ranked.find(entry => (
    entry.candidate.visualLevel === 'world_moment'
    && Boolean(entry.candidate.visualKind)
    && editorialState(entry.candidate, memory) !== 'ongoing'
    && context.elapsedWindow - entry.candidate.changedAt >= 0
    && context.elapsedWindow - entry.candidate.changedAt <= 1
  ));
  const selectedIds = new Set([
    worldMomentEntry?.candidate.id,
    featureEntry?.candidate.id,
    ...signalEntries.map(entry => entry.candidate.id),
  ].filter((id): id is string => Boolean(id)));
  const moreEntries = ranked
    .filter(entry => !selectedIds.has(entry.candidate.id))
    .filter(entry => !isRecentlyUnchanged(entry.candidate, memory, context.elapsedWindow))
    .filter(entry => (
      editorialState(entry.candidate, memory) !== 'ongoing'
      || entry.score >= NARRATIVE_SIGNAL_THRESHOLD
      || entry.candidate.weights.continuity >= 70
    ))
    .sort((left, right) => {
      const leftState = editorialState(left.candidate, memory);
      const rightState = editorialState(right.candidate, memory);
      const stateRank = (state: NarrativeEditorialState) => state === 'changed' ? 2 : state === 'new' ? 1 : 0;
      return stateRank(rightState) - stateRank(leftState)
        || right.score - left.score
        || left.candidate.id.localeCompare(right.candidate.id);
    })
    .slice(0, MAX_MORE_NARRATIVES);

  return {
    ...(featureEntry ? { feature: toNarrativeItem(featureEntry.candidate, memory) } : {}),
    ...(worldMomentEntry ? { worldMoment: toNarrativeItem(worldMomentEntry.candidate, memory) } : {}),
    signals: signalEntries.map(entry => toNarrativeItem(entry.candidate, memory)),
    more: moreEntries.map(entry => toNarrativeItem(entry.candidate, memory)),
    observationRelationFixtureIds: [...new Set(
      reserved.flatMap(candidate => candidate.fixtureIds ?? []),
    )].sort(),
    candidateCount: merged.length,
  };
}

export function advanceNarrativeMemory(
  memory: readonly NarrativeMemoryEntry[],
  digest: NarrativeDigest | null | undefined,
  elapsedWindow: number,
): NarrativeMemoryEntry[] {
  if (!digest) return memory.slice(-MAX_NARRATIVE_MEMORY).map(entry => ({ ...entry }));
  const selected = uniqueByKey(
    [digest.worldMoment, digest.feature, ...digest.signals, ...digest.more]
      .filter((item): item is NarrativeItem => Boolean(item)),
    item => item.arcKey,
  )
    .filter((item): item is NarrativeItem => Boolean(item));
  const next = new Map(memory.map(entry => [entry.arcKey, { ...entry }]));
  for (const item of selected) {
    const prior = next.get(item.arcKey);
    next.set(item.arcKey, {
      arcKey: item.arcKey,
      fingerprint: item.fingerprint,
      lastChangedAt: prior?.fingerprint === item.fingerprint
        ? prior.lastChangedAt
        : item.changedAt,
      lastSelectedAt: elapsedWindow,
    });
  }
  return [...next.values()]
    .sort((left, right) => (
      right.lastSelectedAt - left.lastSelectedAt
      || right.lastChangedAt - left.lastChangedAt
      || left.arcKey.localeCompare(right.arcKey)
    ))
    .slice(0, MAX_NARRATIVE_MEMORY);
}
