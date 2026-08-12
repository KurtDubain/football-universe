import type { StandingEntry } from '../../types/league';
import type { MatchFixture, MatchResult } from '../../types/match';
import type { CalendarWindow } from '../../types/season';
import type { PlayerHighlight } from '../players/player-highlights';
import type { FixtureImportance } from '../season/match-importance';
import type { GameWorld, NewsItem } from '../season/season-manager';
import {
  describeStoryline,
  detectStorylineSignals,
  getStorylineArcKey,
  type Storyline,
  type StorylineSignal,
} from '../season/storylines';
import type { TransferRumor } from '../transfers/rumor-generator';
import { analyzeDestinyDeviation, extractMatchTurningPoints, resolveMatchOutcome } from '../match/analysis';
import { getTeamCoachId } from '../coaches/coach-lookup';
import {
  createNarrativeFingerprint,
  directNarrative,
  mergeNarrativeCandidates,
} from './narrative-director';
import { buildWorldNarrativeCandidates } from './narrative-world-scan';
import type { ObservationTheme } from './observation-theme';
import type { AdvanceWindowOutcome } from './world-response';
import type {
  NarrativeCandidate,
  NarrativeDestination,
  NarrativeDigest,
  NarrativeFact,
  NarrativeMemoryEntry,
  NarrativeSource,
  NarrativeVisualKind,
} from './narrative-types';

interface MatchdayNarrativeOptions {
  world: GameWorld;
  currentWindow: CalendarWindow;
  observationTheme: ObservationTheme | null;
  focusMatches: Array<{ fixture: MatchFixture; importance: FixtureImportance }>;
  playerHighlights: PlayerHighlight[];
  favoriteTeamIds: string[];
  favoritePlayerIds: string[];
  primaryFavoriteTeamId: string | null;
  memory: NarrativeMemoryEntry[];
}

interface ResultNarrativeOptions {
  outcomes: AdvanceWindowOutcome[];
  endWorld: GameWorld;
  previousWorld?: GameWorld;
  favoriteTeamIds: string[];
  favoritePlayerIds: string[];
  primaryFavoriteTeamId: string | null;
  memory: NarrativeMemoryEntry[];
}

function fact(
  source: NarrativeSource,
  key: string,
  label: string,
  detail: string,
): NarrativeFact {
  return { source, key, label, detail };
}

function teamDestination(teamId: string): NarrativeDestination {
  return { key: `team:${teamId}`, label: '查看球队', to: `/team/${teamId}` };
}

function playerDestination(playerId: string): NarrativeDestination {
  return { key: `player:${playerId}`, label: '查看球员', to: `/player/${playerId}` };
}

function fixtureDestination(fixtureId: string): NarrativeDestination {
  return { key: `fixture:${fixtureId}`, label: '查看比赛', fixtureId };
}

function storyVisual(type: StorylineSignal['type']): NarrativeVisualKind {
  return type === 'giant_crisis' ? 'fall' : 'rise';
}

function activeStorySignals(world: GameWorld): Array<{ signal: StorylineSignal; story?: Storyline }> {
  const active = (world.activeStorylines ?? [])
    .map(story => ({ story, signal: describeStoryline(world, story) }))
    .filter((entry): entry is { story: Storyline; signal: StorylineSignal } => Boolean(entry.signal))
    .sort((left, right) => right.signal.priority - left.signal.priority
      || left.story.id.localeCompare(right.story.id));
  if (active.length > 0) return active;
  return detectStorylineSignals(world).slice(0, 8).map(signal => ({ signal }));
}

function observationThemeCandidate(
  theme: ObservationTheme | null,
  world: GameWorld,
): NarrativeCandidate | null {
  if (!theme) return null;
  const subjectIds = [theme.teamId, theme.playerId].filter((id): id is string => Boolean(id));
  return {
    id: `theme:${theme.arcKey}`,
    arcKey: theme.arcKey,
    eventKey: `theme:S${world.seasonState.seasonNumber}:${theme.type}`,
    source: 'observation_theme',
    subjectType: theme.playerId ? 'player' : theme.teamId ? 'team' : 'world',
    subjectIds,
    seasonNumber: world.seasonState.seasonNumber,
    seasonPhase: theme.seasonPhase,
    title: theme.title,
    summary: theme.summary,
    evidence: theme.evidence.map((detail, index) => (
      fact('observation_theme', `theme:${theme.arcKey}:evidence:${index}`, '观察证据', detail)
    )),
    nextWatch: theme.nextWatch,
    destinations: [
      ...(theme.playerId ? [playerDestination(theme.playerId)] : []),
      ...(theme.teamId ? [teamDestination(theme.teamId)] : []),
    ],
    fingerprint: createNarrativeFingerprint([
      theme.arcKey,
      theme.seasonPhase,
      theme.evidence,
      theme.nextWatch,
    ]),
    changedAt: world.totalElapsedWindows ?? 0,
    visualLevel: 'signal',
    presentationPriority: 100,
    weights: { importance: 100, relevance: 100, continuity: 100, historical: 20 },
    reservedForObservationTheme: true,
  };
}

function storylineCandidates(world: GameWorld): NarrativeCandidate[] {
  const active = activeStorySignals(world).slice(0, 8).map(({ signal, story }) => ({
    id: `story:${signal.teamId}:${signal.type}`,
    arcKey: getStorylineArcKey(signal.teamId, signal.type, signal.competitionName),
    eventKey: story?.id ?? `derived:${signal.teamId}:${signal.type}`,
    source: 'storyline' as const,
    subjectType: 'team' as const,
    subjectIds: [signal.teamId],
    seasonNumber: world.seasonState.seasonNumber,
    seasonPhase: signal.phase,
    storylineType: signal.type,
    title: signal.title,
    summary: signal.body,
    evidence: signal.evidence.map((detail, index) => (
      fact('storyline', `story:${signal.teamId}:${signal.type}:evidence:${index}`, '故事证据', detail)
    )),
    nextWatch: signal.nextWatch,
    destinations: [teamDestination(signal.teamId)],
    visualKind: storyVisual(signal.type),
    visualLevel: 'chapter' as const,
    presentationPriority: signal.phase === '高潮' ? 90 : signal.phase === '发展' ? 70 : 50,
    fingerprint: createNarrativeFingerprint([
      signal.teamId,
      signal.type,
      signal.phase,
      signal.evidence,
      signal.nextWatch,
    ]),
    changedAt: story?.lastUpdatedElapsedWindow ?? (world.totalElapsedWindows ?? 0),
    weights: {
      importance: Math.min(92, 54 + signal.priority),
      relevance: 20,
      continuity: signal.phase === '高潮' ? 92 : signal.phase === '发展' ? 75 : 55,
      historical: signal.phase === '高潮' ? 75 : 25,
    },
  }));
  const labels: Record<Storyline['type'], string> = {
    dark_horse: '黑马崛起',
    giant_crisis: '豪门危机',
    promoted_survival: '升班马求生',
    unbeaten_run: '联赛不败征程',
    cup_giant_killer: '杯赛巨人杀手',
  };
  const resolved = (world.storylineHistory ?? [])
    .filter(story =>
      story.phase === '落幕'
      && story.seasonNumber === world.seasonState.seasonNumber
      && Boolean(story.conclusion),
    )
    .sort((left, right) =>
      (right.endedWindow ?? right.lastUpdatedWindow) - (left.endedWindow ?? left.lastUpdatedWindow)
      || left.id.localeCompare(right.id),
    )
    .slice(0, 2)
    .map(story => ({
      id: `story-resolved:${story.id}`,
      arcKey: getStorylineArcKey(story.teamId, story.type, story.competitionName),
      eventKey: `resolved:${story.id}`,
      source: 'storyline' as const,
      subjectType: 'team' as const,
      subjectIds: [story.teamId],
      seasonNumber: story.seasonNumber,
      seasonPhase: '落幕',
      storylineType: story.type,
      title: `${labels[story.type]} · ${story.outcome === 'success' ? '成章' : '定格'}`,
      summary: story.conclusion!,
      evidence: story.evidence.map((detail, index) => (
        fact('storyline', `story:${story.id}:resolved-evidence:${index}`, '历程证据', detail)
      )),
      consequences: [fact(
        'storyline',
        `story:${story.id}:conclusion`,
        '故事结局',
        story.conclusion!,
      )],
      nextWatch: story.outcome === 'success'
        ? '这段故事已进入赛季档案，下一阶段由真实赛程继续书写'
        : '这段故事已经结束，只有新的事实达到门槛才会重新开启',
      destinations: [teamDestination(story.teamId)],
      visualKind: storyVisual(story.type),
      visualLevel: story.outcome === 'success' ? 'world_moment' as const : 'chapter' as const,
      presentationPriority: story.outcome === 'success' ? 100 : 85,
      fingerprint: createNarrativeFingerprint([
        story.id,
        story.outcome,
        story.conclusion,
        story.evidence,
      ]),
      changedAt: story.lastUpdatedElapsedWindow,
      weights: {
        importance: story.outcome === 'success' ? 86 : 72,
        relevance: 20,
        continuity: 88,
        historical: story.outcome === 'success' ? 72 : 40,
      },
    }));
  return [...active, ...resolved];
}

function relatedStoryArc(world: GameWorld, fixture: MatchFixture): string | null {
  const stories = (world.activeStorylines ?? [])
    .filter(story => story.teamId === fixture.homeTeamId || story.teamId === fixture.awayTeamId)
    .sort((left, right) => (
      right.lastUpdatedElapsedWindow - left.lastUpdatedElapsedWindow
      || left.id.localeCompare(right.id)
    ));
  const story = stories[0];
  return story
    ? getStorylineArcKey(story.teamId, story.type, story.competitionName)
    : null;
}

function focusFixtureCandidates(options: MatchdayNarrativeOptions): NarrativeCandidate[] {
  const { world, observationTheme, favoriteTeamIds, primaryFavoriteTeamId } = options;
  const favoriteSet = new Set(favoriteTeamIds);
  return options.focusMatches.map(({ fixture, importance }) => {
    const home = world.teamBases[fixture.homeTeamId];
    const away = world.teamBases[fixture.awayTeamId];
    const belongsToTheme = Boolean(
      observationTheme?.teamId
      && (observationTheme.teamId === fixture.homeTeamId || observationTheme.teamId === fixture.awayTeamId)
      && observationTheme.type !== 'player_growth'
    );
    const arcKey = belongsToTheme
      ? observationTheme!.arcKey
      : relatedStoryArc(world, fixture) ?? `fixture:${fixture.id}:stakes`;
    const subjectIds = [fixture.homeTeamId, fixture.awayTeamId];
    const primaryInvolved = Boolean(
      primaryFavoriteTeamId && subjectIds.includes(primaryFavoriteTeamId)
    );
    const favoriteInvolved = subjectIds.some(id => favoriteSet.has(id));
    const reasons = importance.reasons.length > 0 ? importance.reasons : ['本轮焦点赛程'];
    return {
      id: `focus:${fixture.id}`,
      arcKey,
      eventKey: fixture.id,
      source: 'focus_fixture' as const,
      subjectType: 'fixture' as const,
      subjectIds,
      fixtureIds: [fixture.id],
      seasonNumber: world.seasonState.seasonNumber,
      seasonPhase: fixture.roundLabel,
      title: `${home?.shortName ?? fixture.homeTeamId} vs ${away?.shortName ?? fixture.awayTeamId}`,
      summary: `${fixture.competitionName} · ${fixture.roundLabel}，${reasons.join('、')}。`,
      evidence: reasons.map((detail, index) => (
        fact('focus_fixture', `focus:${fixture.id}:reason:${index}`, '关注理由', detail)
      )),
      nextWatch: '可锁定本场，推进后直接进入无剧透观战',
      destinations: [fixtureDestination(fixture.id)],
      visualKind: reasons.some(reason => reason.includes('决赛')) ? 'stage' as const : undefined,
      visualLevel: reasons.some(reason => reason.includes('决赛')) ? 'world_moment' as const : 'signal' as const,
      presentationPriority: reasons.some(reason => reason.includes('决赛')) ? 90 : 35,
      fingerprint: createNarrativeFingerprint([fixture.id, reasons]),
      changedAt: world.totalElapsedWindows ?? 0,
      weights: {
        importance: Math.min(92, 52 + importance.score * 3),
        relevance: primaryInvolved ? 55 : favoriteInvolved ? 35 : 10,
        continuity: arcKey.startsWith('team:') ? 65 : 25,
        historical: reasons.some(reason => reason.includes('决赛')) ? 90 : 20,
      },
    };
  });
}

interface WindowSignal {
  fixture: MatchFixture;
  kind: 'title' | 'relegation' | 'marquee' | 'upset_watch' | 'coach_pressure';
  priority: number;
  title: string;
  summary: string;
  subjectIds: string[];
  arcKey: string;
}

function standingsForTeam(world: GameWorld, teamId: string): StandingEntry[] | null {
  return [world.league1Standings, world.league2Standings, world.league3Standings]
    .find(table => table.some(row => row.teamId === teamId)) ?? null;
}

function deriveWindowSignals(
  world: GameWorld,
  fixtures: MatchFixture[],
  excludedFixtureIds: ReadonlySet<string>,
): WindowSignal[] {
  const signals: WindowSignal[] = [];
  for (const fixture of fixtures) {
    if (excludedFixtureIds.has(fixture.id)) continue;
    const home = world.teamBases[fixture.homeTeamId];
    const away = world.teamBases[fixture.awayTeamId];
    if (!home || !away) continue;
    const candidates: WindowSignal[] = [];
    const standings = fixture.competitionType === 'league'
      ? standingsForTeam(world, fixture.homeTeamId)
      : null;
    const homeRank = standings?.findIndex(row => row.teamId === fixture.homeTeamId) ?? -1;
    const awayRank = standings?.findIndex(row => row.teamId === fixture.awayTeamId) ?? -1;
    if (standings && homeRank >= 0 && awayRank >= 0) {
      const homePosition = homeRank + 1;
      const awayPosition = awayRank + 1;
      if (homePosition <= 3 && awayPosition <= 3 && (standings[0]?.played ?? 0) > 5) {
        candidates.push({
          fixture,
          kind: 'title',
          priority: 5,
          title: '争冠直接对话',
          summary: `${home.name}(第${homePosition})迎战${away.name}(第${awayPosition})，积分榜上游将直接发生变化。`,
          subjectIds: [home.id, away.id],
          arcKey: `competition:league-title:${world.seasonState.seasonNumber}`,
        });
      }
      if (
        homePosition >= standings.length - 2
        && awayPosition >= standings.length - 2
        && standings.length > 4
        && (standings[0]?.played ?? 0) >= 4
      ) {
        candidates.push({
          fixture,
          kind: 'relegation',
          priority: 5,
          title: '保级线直接对话',
          summary: `${home.name}(第${homePosition})对阵${away.name}(第${awayPosition})，双方都需要积分。`,
          subjectIds: [home.id, away.id],
          arcKey: `competition:league-survival:${world.seasonState.seasonNumber}`,
        });
      }
    }
    const pressuredTeams = [fixture.homeTeamId, fixture.awayTeamId]
      .filter(teamId => (world.teamStates[teamId]?.coachPressure ?? 0) > 55);
    for (const teamId of pressuredTeams) {
      const coachId = getTeamCoachId(world.coachStates, teamId);
      const coach = coachId ? world.coachBases[coachId] : null;
      const team = world.teamBases[teamId];
      if (!coach || !team) continue;
      candidates.push({
        fixture,
        kind: 'coach_pressure',
        priority: 4,
        title: `${team.shortName}主帅承压`,
        summary: `${coach.name}当前压力值${world.teamStates[teamId].coachPressure}，下一场结果值得观察。`,
        subjectIds: [teamId, coachId!],
        arcKey: `team:${teamId}:coach-pressure`,
      });
    }
    const strengthGap = Math.abs(home.overall - away.overall);
    if (strengthGap >= 15) {
      const stronger = home.overall > away.overall ? home : away;
      const weaker = stronger === home ? away : home;
      candidates.push({
        fixture,
        kind: 'upset_watch',
        priority: 3,
        title: '强弱对话',
        summary: `${weaker.name}挑战${stronger.name}，基础能力相差${strengthGap}档。`,
        subjectIds: [home.id, away.id],
        arcKey: `fixture:${fixture.id}:upset-watch`,
      });
    }
    if (
      (home.tier === 'elite' || home.tier === 'strong')
      && (away.tier === 'elite' || away.tier === 'strong')
    ) {
      candidates.push({
        fixture,
        kind: 'marquee',
        priority: 2,
        title: '强强对话',
        summary: `${home.name}与${away.name}在${fixture.competitionName}相遇。`,
        subjectIds: [home.id, away.id],
        arcKey: `fixture:${fixture.id}:marquee`,
      });
    }
    const selected = candidates.sort((left, right) => (
      right.priority - left.priority || left.kind.localeCompare(right.kind)
    ))[0];
    if (selected) signals.push(selected);
  }
  return signals
    .sort((left, right) => right.priority - left.priority || left.fixture.id.localeCompare(right.fixture.id))
    .slice(0, 2);
}

function windowSignalCandidates(
  options: MatchdayNarrativeOptions,
  focusFixtureIds: ReadonlySet<string>,
): NarrativeCandidate[] {
  const favoriteSet = new Set(options.favoriteTeamIds);
  return deriveWindowSignals(options.world, options.currentWindow.fixtures, focusFixtureIds)
    .map(signal => ({
      id: `window:${signal.fixture.id}:${signal.kind}`,
      arcKey: signal.arcKey,
      eventKey: `${signal.fixture.id}:${signal.kind}`,
      source: signal.kind === 'coach_pressure' ? 'coach_pressure' as const : 'window_signal' as const,
      subjectType: signal.kind === 'coach_pressure' ? 'coach' as const : 'fixture' as const,
      subjectIds: signal.subjectIds,
      fixtureIds: [signal.fixture.id],
      seasonNumber: options.world.seasonState.seasonNumber,
      seasonPhase: signal.fixture.roundLabel,
      title: signal.title,
      summary: signal.summary,
      evidence: [fact(
        signal.kind === 'coach_pressure' ? 'coach_pressure' : 'window_signal',
        `window:${signal.fixture.id}:${signal.kind}`,
        '本轮线索',
        signal.summary,
      )],
      nextWatch: '观察赛果是否改变当前判断',
      destinations: [fixtureDestination(signal.fixture.id)],
      visualKind: signal.kind === 'coach_pressure' ? 'fall' as const : undefined,
      visualLevel: signal.kind === 'coach_pressure' ? 'chapter' as const : 'signal' as const,
      presentationPriority: signal.kind === 'coach_pressure' ? 55 : 30 + signal.priority,
      fingerprint: createNarrativeFingerprint([signal.fixture.id, signal.kind, signal.summary]),
      changedAt: options.world.totalElapsedWindows ?? 0,
      weights: {
        importance: 50 + signal.priority * 6,
        relevance: signal.subjectIds.some(id => favoriteSet.has(id)) ? 35 : 8,
        continuity: signal.kind === 'coach_pressure' ? 62 : 20,
        historical: 10,
      },
    }));
}

function playerHighlightCandidates(options: MatchdayNarrativeOptions): NarrativeCandidate[] {
  const followed = new Set(options.favoritePlayerIds);
  return options.playerHighlights.slice(0, 3).map(highlight => ({
    id: `highlight:${highlight.fixtureId}:${highlight.playerId}:${highlight.label}`,
    arcKey: `player:${highlight.playerId}:match:${highlight.fixtureId}`,
    eventKey: `${highlight.fixtureId}:${highlight.label}`,
    source: 'player_highlight' as const,
    subjectType: 'player' as const,
    subjectIds: [highlight.playerId, highlight.teamId],
    fixtureIds: [highlight.fixtureId],
    seasonNumber: options.world.seasonState.seasonNumber,
    seasonPhase: options.currentWindow.label,
    title: `${highlight.playerName} · ${highlight.label}`,
    summary: `${highlight.detail}，对手为${options.world.teamBases[highlight.opponentTeamId]?.name ?? highlight.opponentTeamId}。`,
    evidence: [fact(
      'player_highlight',
      `highlight:${highlight.fixtureId}:${highlight.playerId}`,
      highlight.label,
      highlight.detail,
    )],
    destinations: [playerDestination(highlight.playerId), fixtureDestination(highlight.fixtureId)],
    visualKind: 'legacy' as const,
    visualLevel: highlight.priority >= 10 ? 'world_moment' as const : 'signal' as const,
    presentationPriority: Math.min(85, 45 + highlight.priority * 3),
    fingerprint: createNarrativeFingerprint([
      highlight.fixtureId,
      highlight.playerId,
      highlight.label,
      highlight.detail,
    ]),
    changedAt: options.world.totalElapsedWindows ?? 0,
    weights: {
      importance: Math.min(96, 58 + highlight.priority * 3),
      relevance: followed.has(highlight.playerId) ? 72 : 20,
      continuity: 25,
      historical: highlight.priority >= 10 ? 72 : 35,
    },
  }));
}

function rumorCandidates(options: MatchdayNarrativeOptions): NarrativeCandidate[] {
  const favoriteTeams = new Set(options.favoriteTeamIds);
  const favoritePlayers = new Set(options.favoritePlayerIds);
  return (options.world.transferRumors ?? [])
    .filter(rumor =>
      rumor.intensity === 'high'
      || favoritePlayers.has(rumor.candidateUuid)
      || favoriteTeams.has(rumor.fromTeamId)
      || favoriteTeams.has(rumor.eliteTeamId),
    )
    .slice(-8)
    .reverse()
    .slice(0, 4)
    .map((rumor: TransferRumor) => ({
      id: `rumor:${rumor.id}`,
      arcKey: `transfer:${rumor.candidateUuid}:${rumor.eliteTeamId}`,
      eventKey: rumor.id,
      source: 'transfer_rumor' as const,
      subjectType: 'player' as const,
      subjectIds: [rumor.candidateUuid, rumor.fromTeamId, rumor.eliteTeamId],
      seasonNumber: rumor.season,
      seasonPhase: '转会观察',
      title: `${rumor.eliteTeamName}关注${rumor.candidateName}`,
      summary: `${rumor.candidateName}仍属于${rumor.fromTeamName}；传闻不会强制转会发生。`,
      evidence: [fact(
        'transfer_rumor',
        rumor.id,
        rumor.intensity === 'high' ? '紧锣密鼓' : rumor.intensity === 'medium' ? '深入接触' : '初步关注',
        `${rumor.candidatePosition} · ${rumor.fromTeamName} → ${rumor.eliteTeamName}`,
      )],
      nextWatch: '观察转会窗口中是否出现真实报价或成交',
      destinations: [
        playerDestination(rumor.candidateUuid),
        teamDestination(rumor.fromTeamId),
        teamDestination(rumor.eliteTeamId),
      ],
      visualKind: 'transfer' as const,
      visualLevel: rumor.intensity === 'high' ? 'chapter' as const : 'signal' as const,
      presentationPriority: rumor.intensity === 'high' ? 58 : 35,
      fingerprint: createNarrativeFingerprint([rumor.id, rumor.intensity]),
      changedAt: options.world.totalElapsedWindows ?? 0,
      weights: {
        importance: rumor.intensity === 'high' ? 78 : rumor.intensity === 'medium' ? 65 : 52,
        relevance: favoritePlayers.has(rumor.candidateUuid)
          || favoriteTeams.has(rumor.fromTeamId)
          || favoriteTeams.has(rumor.eliteTeamId)
          ? 58
          : 12,
        continuity: 45,
        historical: 15,
      },
    }));
}

function newsVisualKind(news: NewsItem): NarrativeVisualKind | undefined {
  if (news.subject?.visualKind) return news.subject.visualKind;
  if (news.type === 'trophy' || news.type === 'promotion') return 'stage';
  if (news.type === 'relegation' || news.type === 'coach_fired' || news.type === 'injury') return 'fall';
  if (news.type === 'coach_hired') return 'rise';
  if (news.type === 'retirement') return 'legacy';
  if (news.type === 'rumor') return 'transfer';
  return undefined;
}

function newsVisualLevel(news: NewsItem): 'signal' | 'chapter' | 'world_moment' {
  if (
    news.type === 'trophy'
    || news.type === 'promotion'
    || news.type === 'relegation'
    || news.type === 'retirement'
    || (news.type === 'coach_fired' && news.importance === 'major')
  ) return 'world_moment';
  if (
    news.type === 'coach_hired'
    || news.type === 'coach_fired'
    || news.type === 'injury'
    || news.type === 'rumor'
  ) return 'chapter';
  return 'signal';
}

function newsChangedAt(world: GameWorld, news: NewsItem): number {
  const currentSeason = world.seasonState.seasonNumber;
  const elapsed = world.totalElapsedWindows ?? 0;
  if (news.seasonNumber === currentSeason) {
    return Math.max(0, elapsed - Math.max(0, world.seasonState.currentWindowIndex - news.windowIndex));
  }
  if (news.seasonNumber === currentSeason - 1) {
    const lastNewsWindow = Math.max(
      news.windowIndex,
      ...world.newsLog
        .filter(item => item.seasonNumber === news.seasonNumber)
        .map(item => item.windowIndex),
    );
    return Math.max(
      0,
      elapsed - world.seasonState.currentWindowIndex - Math.max(0, lastNewsWindow - news.windowIndex),
    );
  }
  return 0;
}

function newsCandidates(
  world: GameWorld,
  newsItems: NewsItem[],
  excludedTypes: ReadonlySet<NewsItem['type']>,
): NarrativeCandidate[] {
  return newsItems
    .filter(news => !excludedTypes.has(news.type) && news.importance !== 'minor')
    .slice(-12)
    .reverse()
    .map(news => {
      const teamIds = news.subject?.teamIds ?? [];
      const playerIds = news.subject?.playerIds ?? [];
      const coachIds = news.subject?.coachIds ?? [];
      const subjectIds = [...teamIds, ...playerIds, ...coachIds];
      const destinations = [
        ...teamIds.map(teamDestination),
        ...playerIds.map(playerDestination),
        ...coachIds.map(coachId => ({
          key: `coach:${coachId}`,
          label: '查看教练',
          to: `/coach/${coachId}`,
        })),
      ];
      return {
        id: `news:${news.id}`,
        arcKey: news.subject?.arcKey ?? `news:${news.type}:${news.id}`,
        eventKey: news.subject?.eventKey ?? news.id,
        source: 'news' as const,
        subjectType: playerIds.length > 0
          ? 'player' as const
          : coachIds.length > 0
            ? 'coach' as const
            : teamIds.length > 0
              ? 'team' as const
              : 'world' as const,
        subjectIds,
        fixtureIds: news.fixtureId ? [news.fixtureId] : [],
        seasonNumber: news.seasonNumber,
        seasonPhase: `窗口 ${news.windowIndex + 1}`,
        title: news.title,
        summary: news.description,
        evidence: [fact('news', news.id, '足坛动态', news.description)],
        destinations: [
          ...destinations,
          ...(news.fixtureId ? [fixtureDestination(news.fixtureId)] : []),
        ],
        visualKind: newsVisualKind(news),
        visualLevel: newsVisualLevel(news),
        presentationPriority: news.importance === 'major' ? 75 : 40,
        fingerprint: createNarrativeFingerprint([news.id, news.type, news.description]),
        changedAt: newsChangedAt(world, news),
        weights: {
          importance: news.importance === 'major' ? 86 : 60,
          relevance: subjectIds.length > 0 ? 22 : 5,
          continuity: news.subject?.arcKey ? 45 : 10,
          historical: news.type === 'trophy' || news.type === 'retirement' ? 90 : 25,
        },
      };
    });
}

export function buildMatchdayNarrativeDigest(options: MatchdayNarrativeOptions): NarrativeDigest {
  const focusFixtureIds = new Set(options.focusMatches.map(entry => entry.fixture.id));
  const theme = observationThemeCandidate(options.observationTheme, options.world);
  const candidates: NarrativeCandidate[] = [
    ...(theme ? [theme] : []),
    ...storylineCandidates(options.world),
    ...focusFixtureCandidates(options),
    ...windowSignalCandidates(options, focusFixtureIds),
    ...playerHighlightCandidates(options),
    ...rumorCandidates(options),
    ...buildWorldNarrativeCandidates({
      world: options.world,
      currentWindow: options.currentWindow,
      favoriteTeamIds: options.favoriteTeamIds,
      favoritePlayerIds: options.favoritePlayerIds,
    }),
    ...newsCandidates(
      options.world,
      options.world.newsLog,
      new Set([
        'match_result',
        'upset',
        'streak',
        'storyline',
        'rumor',
        'coach_fired',
        'coach_hired',
        'injury',
      ]),
    ),
  ];
  return directNarrative(candidates, options.memory, {
    elapsedWindow: options.world.totalElapsedWindows ?? 0,
    favoriteTeamIds: options.favoriteTeamIds,
    favoritePlayerIds: options.favoritePlayerIds,
  });
}

function scoreLabel(result: MatchResult): string {
  const home = result.homeGoals + (result.etHomeGoals ?? 0);
  const away = result.awayGoals + (result.etAwayGoals ?? 0);
  return result.penalties
    ? `${home}:${away}，点球${result.penaltyHome ?? 0}:${result.penaltyAway ?? 0}`
    : `${home}:${away}`;
}

function standingPosition(world: GameWorld, teamId: string): { rank: number; row: StandingEntry } | null {
  for (const table of [world.league1Standings, world.league2Standings, world.league3Standings]) {
    const index = table.findIndex(row => row.teamId === teamId);
    if (index >= 0) return { rank: index + 1, row: table[index] };
  }
  return null;
}

function resultConsequences(
  result: MatchResult,
  previousWorld: GameWorld | undefined,
  endWorld: GameWorld,
  outcome: AdvanceWindowOutcome,
): NarrativeFact[] {
  const consequences: NarrativeFact[] = [];
  if (previousWorld?.seasonState.seasonNumber === endWorld.seasonState.seasonNumber) {
    for (const teamId of [result.homeTeamId, result.awayTeamId]) {
      const before = standingPosition(previousWorld, teamId);
      const after = standingPosition(endWorld, teamId);
      const teamName = endWorld.teamBases[teamId]?.shortName ?? teamId;
      if (before && after && before.rank !== after.rank) {
        consequences.push(fact(
          'match_result',
          `result:${result.fixtureId}:rank:${teamId}`,
          '推进后排名',
          `${teamName}由第${before.rank}变为第${after.rank}。`,
        ));
      }
      const beforePressure = previousWorld.teamStates[teamId]?.coachPressure;
      const afterPressure = endWorld.teamStates[teamId]?.coachPressure;
      if (
        beforePressure != null
        && afterPressure != null
        && Math.abs(afterPressure - beforePressure) >= 5
      ) {
        consequences.push(fact(
          'match_result',
          `result:${result.fixtureId}:pressure:${teamId}`,
          '推进后压力',
          `${teamName}教练压力${afterPressure > beforePressure ? '升至' : '降至'}${afterPressure}。`,
        ));
      }
    }
  }
  for (const news of outcome.news.filter(item => item.fixtureId === result.fixtureId)) {
    if (news.type === 'match_result' || news.type === 'upset') continue;
    consequences.push(fact(
      'news',
      `result:${result.fixtureId}:news:${news.id}`,
      '后续记录',
      news.description,
    ));
  }
  const round = result.roundLabel.trim().toLowerCase();
  const final = round === 'final' || result.roundLabel.trim() === '决赛';
  if (final) {
    const winnerId = resolveMatchOutcome(result) === 'home' ? result.homeTeamId : result.awayTeamId;
    consequences.push(fact(
      'match_result',
      `result:${result.fixtureId}:champion`,
      '奖杯归属',
      `${endWorld.teamBases[winnerId]?.name ?? winnerId}赢得${result.competitionName}。`,
    ));
  }
  return consequences
    .sort((left, right) => {
      const priority = (item: NarrativeFact) => item.label === '奖杯归属'
        ? 3
        : item.label === '后续记录'
          ? 2
          : 1;
      return priority(right) - priority(left) || left.key.localeCompare(right.key);
    })
    .slice(0, 4);
}

function outcomeChangedAt(
  options: ResultNarrativeOptions,
  outcome: AdvanceWindowOutcome,
): number {
  const currentSeason = options.endWorld.seasonState.seasonNumber;
  const elapsed = options.endWorld.totalElapsedWindows ?? 0;
  if (outcome.seasonNumber === currentSeason) {
    return Math.max(
      0,
      elapsed - Math.max(0, options.endWorld.seasonState.currentWindowIndex - outcome.windowIndex),
    );
  }
  if (outcome.seasonNumber === currentSeason - 1) {
    const lastOutcomeWindow = Math.max(
      outcome.windowIndex,
      ...options.outcomes
        .filter(item => item.seasonNumber === outcome.seasonNumber)
        .map(item => item.windowIndex),
    );
    return Math.max(
      0,
      elapsed
        - options.endWorld.seasonState.currentWindowIndex
        - Math.max(0, lastOutcomeWindow - outcome.windowIndex),
    );
  }
  return 0;
}

function resultCandidate(
  result: MatchResult,
  outcome: AdvanceWindowOutcome,
  options: ResultNarrativeOptions,
): NarrativeCandidate {
  const { endWorld, previousWorld, favoriteTeamIds, primaryFavoriteTeamId } = options;
  const home = endWorld.teamBases[result.homeTeamId];
  const away = endWorld.teamBases[result.awayTeamId];
  const deviation = analyzeDestinyDeviation(result);
  const turningPoints = extractMatchTurningPoints(result);
  const subjectIds = [result.homeTeamId, result.awayTeamId];
  const primaryInvolved = Boolean(primaryFavoriteTeamId && subjectIds.includes(primaryFavoriteTeamId));
  const favoriteInvolved = subjectIds.some(id => favoriteTeamIds.includes(id));
  const final = result.roundLabel.trim().toLowerCase() === 'final' || result.roundLabel.trim() === '决赛';
  const factors = [...(result.prediction?.factors ?? [])]
    .sort((left, right) => right.importance - left.importance || left.source.localeCompare(right.source))
    .slice(0, 3);
  const causes = factors.map(factorItem => fact(
    'match_result',
    `result:${result.fixtureId}:factor:${factorItem.source}`,
    factorItem.label,
    factorItem.detail,
  ));
  const evidence: NarrativeFact[] = [
    fact(
      'match_result',
      `result:${result.fixtureId}:forecast`,
      '赛前分布',
      result.prediction
        ? `主胜${result.prediction.homeWinPct}% · 平${result.prediction.drawPct}% · 客胜${result.prediction.awayWinPct}%`
        : '旧比赛没有冻结的赛前分布。',
    ),
    fact(
      'match_result',
      `result:${result.fixtureId}:deviation`,
      deviation.label,
      `${deviation.summary}${result.prediction ? ` 实际结果赛前概率约${deviation.actualProbability}%。` : ''}`,
    ),
    fact(
      'match_result',
      `result:${result.fixtureId}:shots`,
      '比赛数据',
      `射门${result.stats.shots[0]}:${result.stats.shots[1]} · 射正${result.stats.shotsOnTarget[0]}:${result.stats.shotsOnTarget[1]}`,
    ),
  ];
  return {
    id: `result:${outcome.seasonNumber}:${result.fixtureId}`,
    arcKey: `fixture:${result.fixtureId}:result`,
    eventKey: `${outcome.seasonNumber}:${outcome.windowIndex}:${result.fixtureId}`,
    source: 'match_result',
    subjectType: 'fixture',
    subjectIds,
    fixtureIds: [result.fixtureId],
    seasonNumber: outcome.seasonNumber,
    seasonPhase: result.roundLabel,
    title: `${home?.shortName ?? result.homeTeamId} ${scoreLabel(result)} ${away?.shortName ?? result.awayTeamId}`,
    summary: `${result.competitionName} · ${deviation.label}。`,
    causes,
    evidence,
    turningPoints: turningPoints.map((point, index) => fact(
      'match_result',
      `result:${result.fixtureId}:turn:${point.type}:${index}`,
      point.title,
      point.detail,
    )),
    consequences: resultConsequences(
      result,
      options.outcomes.length === 1 ? previousWorld : undefined,
      endWorld,
      outcome,
    ),
    destinations: [fixtureDestination(result.fixtureId)],
    visualKind: final ? 'stage' : deviation.isUpset ? 'fall' : undefined,
    visualLevel: final || deviation.tier === 'major_upset'
      ? 'world_moment'
      : deviation.isUpset
        ? 'chapter'
        : 'signal',
    presentationPriority: final ? 100 : deviation.tier === 'major_upset' ? 92 : deviation.isUpset ? 72 : 45,
    fingerprint: createNarrativeFingerprint([
      result.fixtureId,
      scoreLabel(result),
      deviation.tier,
      factors.map(item => [item.source, item.evidenceValue]),
      turningPoints,
    ]),
    changedAt: outcomeChangedAt(options, outcome),
    weights: {
      importance: Math.min(100, 48
        + (primaryInvolved ? 24 : favoriteInvolved ? 16 : 0)
        + (final ? 34 : 0)
        + (deviation.isUpset ? 22 : 0)
        + (turningPoints.length > 0 ? 8 : 0)),
      relevance: primaryInvolved ? 62 : favoriteInvolved ? 42 : 8,
      continuity: 28,
      historical: final ? 100 : deviation.tier === 'major_upset' ? 90 : deviation.isUpset ? 70 : 15,
    },
  };
}

function rawResultPriority(
  result: MatchResult,
  ordinal: number,
  options: ResultNarrativeOptions,
): number {
  const subjectIds = [result.homeTeamId, result.awayTeamId];
  const final = result.roundLabel.trim().toLowerCase() === 'final' || result.roundLabel.trim() === '决赛';
  return (options.primaryFavoriteTeamId && subjectIds.includes(options.primaryFavoriteTeamId) ? 300 : 0)
    + (subjectIds.some(id => options.favoriteTeamIds.includes(id)) ? 180 : 0)
    + (final ? 150 : 0)
    + (analyzeDestinyDeviation(result).isUpset ? 100 : 0)
    + ordinal / 10_000;
}

export function buildResultNarrativeDigest(options: ResultNarrativeOptions): NarrativeDigest {
  const rankedResults = options.outcomes.flatMap((outcome, outcomeIndex) => (
    outcome.results.map((result, resultIndex) => ({
      outcome,
      result,
      priority: rawResultPriority(result, outcomeIndex * 100 + resultIndex, options),
    }))
  ))
    .sort((left, right) => right.priority - left.priority || left.result.fixtureId.localeCompare(right.result.fixtureId))
    .slice(0, 24);
  const allNews = options.outcomes.flatMap(outcome => outcome.news);
  const worldCandidates = (world: GameWorld): NarrativeCandidate[] => {
    const currentWindow = world.seasonState.calendar[
      world.seasonState.currentWindowIndex
    ] ?? world.seasonState.calendar.at(-1);
    return [
      ...storylineCandidates(world),
      ...(currentWindow ? buildWorldNarrativeCandidates({
        world,
        currentWindow,
        favoriteTeamIds: options.favoriteTeamIds,
        favoritePlayerIds: options.favoritePlayerIds,
      }) : []),
    ];
  };
  const endWorldCandidates = worldCandidates(options.endWorld);
  const transitionMemory = new Map(options.memory.map(entry => [entry.arcKey, entry]));
  if (options.previousWorld) {
    for (const candidate of mergeNarrativeCandidates(worldCandidates(options.previousWorld))) {
      transitionMemory.set(candidate.arcKey, {
        arcKey: candidate.arcKey,
        fingerprint: candidate.fingerprint,
        lastChangedAt: candidate.changedAt,
        lastSelectedAt: options.previousWorld.totalElapsedWindows ?? 0,
      });
    }
  }
  const candidates = [
    ...rankedResults.map(entry => resultCandidate(entry.result, entry.outcome, options)),
    ...endWorldCandidates,
    ...newsCandidates(
      options.endWorld,
      allNews,
      new Set(['match_result', 'upset', 'streak']),
    ),
  ];
  return directNarrative(candidates, [...transitionMemory.values()], {
    elapsedWindow: options.endWorld.totalElapsedWindows ?? 0,
    favoriteTeamIds: options.favoriteTeamIds,
    favoritePlayerIds: options.favoritePlayerIds,
  });
}
