import { describe, expect, it } from 'vitest';
import type { NarrativeCandidate, NarrativeMemoryEntry } from './narrative-types';
import {
  advanceNarrativeMemory,
  createNarrativeFingerprint,
  directNarrative,
  MAX_NARRATIVE_MEMORY,
  mergeNarrativeCandidates,
} from './narrative-director';

function candidate(
  id: string,
  overrides: Partial<NarrativeCandidate> = {},
): NarrativeCandidate {
  return {
    id,
    arcKey: `arc:${id}`,
    eventKey: `event:${id}`,
    source: 'news',
    subjectType: 'world',
    subjectIds: [],
    seasonNumber: 1,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    evidence: [{ key: `fact:${id}`, label: '证据', detail: id, source: 'news' }],
    fingerprint: createNarrativeFingerprint([id]),
    changedAt: 10,
    weights: { importance: 82, relevance: 40, continuity: 30, historical: 20 },
    ...overrides,
  };
}

describe('narrative director', () => {
  it('is deterministic, stable on ties, and never mutates candidates', () => {
    const candidates = [candidate('b'), candidate('a'), candidate('c')];
    const before = structuredClone(candidates);
    const context = { elapsedWindow: 10 };

    const first = directNarrative(candidates, [], context);
    const second = directNarrative(candidates, [], context);

    expect(first).toEqual(second);
    expect(first.feature?.id).toBe('a');
    expect(candidates).toEqual(before);
    expect(first.feature).not.toHaveProperty('weights');
  });

  it('merges one structured arc while retaining facts, sources, destinations, and fixtures', () => {
    const storyline = candidate('story', {
      arcKey: 'team:t1:story:dark_horse',
      source: 'storyline',
      subjectType: 'team',
      subjectIds: ['t1'],
      evidence: [{ key: 'rank', label: '排名', detail: '第2', source: 'storyline' }],
      destinations: [{ key: 'team:t1', label: '查看球队', to: '/team/t1' }],
    });
    const fixture = candidate('fixture', {
      arcKey: storyline.arcKey,
      source: 'focus_fixture',
      subjectType: 'fixture',
      subjectIds: ['t1', 't2'],
      fixtureIds: ['f1'],
      evidence: [{ key: 'match', label: '赛程', detail: '争冠焦点', source: 'focus_fixture' }],
      destinations: [{ key: 'fixture:f1', label: '查看比赛', fixtureId: 'f1' }],
    });

    const merged = mergeNarrativeCandidates([fixture, storyline]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: 'storyline', fixtureIds: ['f1'] });
    expect(merged[0].subjectIds).toEqual(['t1', 't2']);
    expect(merged[0].evidence?.map(fact => fact.key)).toEqual(['rank', 'match']);
    expect(merged[0].destinations).toHaveLength(2);
    expect(merged[0].sourceRefs).toHaveLength(2);
  });

  it('reserves the observation arc, returns relation fixtures, and enforces 1+2 limits', () => {
    const theme = candidate('theme', {
      arcKey: 'team:t1:story:dark_horse',
      source: 'observation_theme',
      reservedForObservationTheme: true,
      subjectIds: ['t1'],
    });
    const relatedFixture = candidate('related', {
      arcKey: theme.arcKey,
      source: 'focus_fixture',
      subjectIds: ['t1', 't2'],
      fixtureIds: ['fixture-related'],
    });
    const digest = directNarrative(
      [theme, relatedFixture, ...Array.from({ length: 8 }, (_, index) => candidate(`world-${index}`))],
      [],
      { elapsedWindow: 10 },
    );

    expect(digest.feature).toBeDefined();
    expect(digest.signals).toHaveLength(2);
    expect(digest.observationRelationFixtureIds).toEqual(['fixture-related']);
    expect([digest.feature, ...digest.signals, ...digest.more].some(
      item => item?.arcKey === theme.arcKey,
    )).toBe(false);
  });

  it('allows an empty feature when candidates stay below the quality threshold', () => {
    const quiet = candidate('quiet', {
      weights: { importance: 10, relevance: 0, continuity: 0, historical: 0 },
    });
    const digest = directNarrative([quiet], [], { elapsedWindow: 3 });

    expect(digest.feature).toBeUndefined();
    expect(digest.signals).toHaveLength(0);
    expect(digest.more.map(item => item.id)).toEqual(['quiet']);
  });

  it('uses favorites, novelty, continuity, and historical weight without exposing scores', () => {
    const ordinary = candidate('ordinary', {
      subjectIds: ['team-a'],
      weights: { importance: 66, relevance: 10, continuity: 15, historical: 5 },
    });
    const followed = candidate('followed', {
      subjectIds: ['team-favorite'],
      weights: { importance: 80, relevance: 25, continuity: 15, historical: 5 },
    });
    const historical = candidate('historical', {
      weights: { importance: 60, relevance: 0, continuity: 10, historical: 100 },
    });
    const context = { elapsedWindow: 20, favoriteTeamIds: ['team-favorite'] };
    const digest = directNarrative([ordinary, followed, historical], [], context);

    expect(digest.feature?.id).toBe('followed');
    expect(JSON.stringify(digest)).not.toContain('weights');

    const memory: NarrativeMemoryEntry[] = [{
      arcKey: followed.arcKey,
      fingerprint: followed.fingerprint,
      lastChangedAt: 19,
      lastSelectedAt: 20,
    }];
    const afterRepeat = directNarrative([ordinary, followed, historical], memory, context);
    expect(afterRepeat.feature?.id).not.toBe('followed');

    const changed = { ...followed, fingerprint: createNarrativeFingerprint(['changed']) };
    expect(directNarrative([ordinary, changed, historical], memory, context).feature?.id).toBe('followed');
    expect(directNarrative([historical], memory, context).feature?.id).toBe('historical');
  });

  it('keeps presentation memory bounded and updates only selected arcs', () => {
    let memory: NarrativeMemoryEntry[] = Array.from({ length: MAX_NARRATIVE_MEMORY }, (_, index) => ({
      arcKey: `old:${index}`,
      fingerprint: `${index}`,
      lastChangedAt: index,
      lastSelectedAt: index,
    }));
    const digest = directNarrative([candidate('fresh')], [], { elapsedWindow: 100 });
    memory = advanceNarrativeMemory(memory, digest, 100);

    expect(memory).toHaveLength(MAX_NARRATIVE_MEMORY);
    expect(memory[0].arcKey).toBe('arc:fresh');
    expect(memory.some(entry => entry.arcKey === 'old:0')).toBe(false);

    const representativeMaxMemory = Array.from({ length: MAX_NARRATIVE_MEMORY }, (_, index) => ({
      arcKey: `team:representative-${index}:story:giant_crisis`,
      fingerprint: `fingerprint-${index.toString(36)}`,
      lastChangedAt: 999_999,
      lastSelectedAt: 999_999,
    }));
    expect(JSON.stringify(representativeMaxMemory).length).toBeLessThan(6 * 1024);
  });
});
