import { Icon, type IconName } from './Icon';

export type CompetitionIdentityKey =
  | 'league1' | 'league2' | 'league3'
  | 'league_cup' | 'super_cup' | 'world_cup'
  | 'mainland_cup' | 'southern_cup' | 'eastern_cup';

export type StoryStampKind = 'derby' | 'upset' | 'goalfest' | 'final' | 'penalties' | 'comeback' | 'late-winner';
export type OutcomeMarkKind = 'champion' | 'promotion' | 'relegation';

const COMPETITION_TONES: Record<CompetitionIdentityKey, { primary: string; secondary: string }> = {
  league1: { primary: '#d7ad55', secondary: '#734d1d' },
  league2: { primary: '#86abd7', secondary: '#264760' },
  league3: { primary: '#61bd8c', secondary: '#1f5840' },
  league_cup: { primary: '#d7ad55', secondary: '#4c5f70' },
  super_cup: { primary: '#efc96f', secondary: '#8b493f' },
  world_cup: { primary: '#87d9bc', secondary: '#355f7a' },
  mainland_cup: { primary: '#dda860', secondary: '#6c4933' },
  southern_cup: { primary: '#6fc9cf', secondary: '#285d69' },
  eastern_cup: { primary: '#df8e9c', secondary: '#6b354b' },
};

export function CompetitionMark({ type, size = 48, title }: { type: CompetitionIdentityKey; size?: number; title?: string }) {
  const tone = COMPETITION_TONES[type];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="competition-mark shrink-0" role="img" aria-label={title ?? '赛事徽记'}>
      <title>{title ?? '赛事徽记'}</title>
      <path d="M24 2 42 10v18c0 8.2-7.2 14.3-18 18C13.2 42.3 6 36.2 6 28V10Z" fill="#121920" stroke={tone.primary} strokeWidth="1.4" />
      <path d="M24 6 38 12v15.2c0 6.3-5.3 11.1-14 14.3-8.7-3.2-14-8-14-14.3V12Z" fill={tone.secondary} opacity=".78" />
      <CompetitionGlyph type={type} color={tone.primary} />
      <path d="M13 33h22" stroke={tone.primary} strokeWidth="1" opacity=".58" />
      <text x="24" y="38" textAnchor="middle" fill={tone.primary} fontFamily="Inter,Arial,sans-serif" fontSize="5.2" fontWeight="800">
        {competitionCode(type)}
      </text>
    </svg>
  );
}

function CompetitionGlyph({ type, color }: { type: CompetitionIdentityKey; color: string }) {
  const common = { fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (type === 'league1') return <g {...common}><path d="m15 23 3-11 6 6 6-6 3 11Z" /><path d="M15 26h18" /></g>;
  if (type === 'league2') return <g {...common}><path d="m15 13 9 12 9-12" /><path d="m18 13 6 7 6-7M18 28h12" /></g>;
  if (type === 'league3') return <g {...common}><path d="M15 27v-7h5v7m2 0V15h5v12m2 0V10h5v17" /></g>;
  if (type === 'world_cup') return <g {...common}><circle cx="24" cy="19" r="9" /><path d="M15 19h18M24 10c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z" /></g>;
  if (type === 'mainland_cup') return <g {...common}><path d="m13 26 8-13 4 7 4-5 6 11Z" /><path d="M14 29h20" /></g>;
  if (type === 'southern_cup') return <g {...common}><path d="M12 16c4 0 4 5 8 5s4-5 8-5 4 5 8 5M12 25c4 0 4-4 8-4" /></g>;
  if (type === 'eastern_cup') return <g {...common}><circle cx="24" cy="18" r="6" /><path d="M24 8v4m0 12v4m10-10h-4m-12 0h-4m17-7-3 3m-8 8-3 3" /></g>;
  if (type === 'super_cup') return <g {...common}><path d="m24 9 2.8 6 6.5.8-4.8 4.5 1.2 6.4-5.7-3.2-5.7 3.2 1.2-6.4-4.8-4.5 6.5-.8Z" /></g>;
  return <g {...common}><path d="M17 11h14v5c0 6-3 10-7 10s-7-4-7-10Z" /><path d="M17 14h-5c0 5 2 8 6 8m13-8h5c0 5-2 8-6 8M24 26v4m-5 0h10" /></g>;
}

function competitionCode(type: CompetitionIdentityKey): string {
  const codes: Record<CompetitionIdentityKey, string> = {
    league1: 'L1', league2: 'L2', league3: 'L3', league_cup: 'LC', super_cup: 'SC', world_cup: 'WC',
    mainland_cup: 'ML', southern_cup: 'ST', eastern_cup: 'ET',
  };
  return codes[type];
}

export function TrophyMark({ type = 'league1', size = 30 }: { type?: CompetitionIdentityKey; size?: number }) {
  const tone = COMPETITION_TONES[type];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <TrophyGlyph type={type} color={tone.primary} />
    </svg>
  );
}

function TrophyGlyph({ type, color }: { type: CompetitionIdentityKey; color: string }) {
  const base = <path d="M16 21v5m-6 3h12m-10-3h8" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />;
  if (type === 'league_cup') return <><path d="M11 3h10v9c0 5-2 9-5 9s-5-4-5-9Z" fill={color} /><path d="M11 7H5c0 6 2 10 7 10m9-10h6c0 6-2 10-7 10" fill="none" stroke={color} strokeWidth="2" />{base}</>;
  if (type === 'super_cup') return <><path d="m16 2 3 6 7 .9-5 4.8 1.3 6.8-6.3-3.4-6.3 3.4 1.3-6.8-5-4.8L13 8Z" fill={color} />{base}</>;
  if (type === 'world_cup') return <><circle cx="16" cy="9" r="7" fill="none" stroke={color} strokeWidth="2.4" /><path d="M9 9h14M16 2c2.5 2.2 3.5 4.6 3.5 7S18.5 13.8 16 16c-2.5-2.2-3.5-4.6-3.5-7S13.5 4.2 16 2Z" fill="none" stroke={color} strokeWidth="1.2" /><path d="M13 17h6l1 9h-8Z" fill={color} /><path d="M9 29h14" stroke={color} strokeWidth="2" /></>;
  if (type === 'mainland_cup') return <><path d="m5 18 7-12 4 7 3-4 8 9Z" fill={color} /><path d="M12 19h8l-1 7h-6Z" fill={color} /><path d="M9 29h14" stroke={color} strokeWidth="2" /></>;
  if (type === 'southern_cup') return <><path d="M5 8c4 0 4 5 8 5s4-5 8-5 4 5 8 5M5 15c4 0 4-4 8-4" fill="none" stroke={color} strokeWidth="2.2" /><path d="M11 17h10l-2 9h-6Z" fill={color} /><path d="M9 29h14" stroke={color} strokeWidth="2" /></>;
  if (type === 'eastern_cup') return <><circle cx="16" cy="9" r="6" fill={color} /><path d="M16 1v3m0 10v3M6 9h3m14 0h3M9 2l2 2m10 10 2 2M23 2l-2 2M11 14l-2 2" stroke={color} strokeWidth="1.5" /><path d="M12 17h8l-1 9h-6Z" fill={color} /><path d="M9 29h14" stroke={color} strokeWidth="2" /></>;
  return <><path d="M9 4h14v6c0 7-3 11-7 11S9 17 9 10Z" fill={color} /><path d="M9 7H4c0 6 2.5 9 7 9m12-9h5c0 6-2.5 9-7 9" fill="none" stroke={color} strokeWidth="2" />{base}</>;
}

export function OutcomeMark({ kind, size = 18 }: { kind: OutcomeMarkKind; size?: number }) {
  const color = kind === 'champion' ? '#d7ad55' : kind === 'promotion' ? '#3fb978' : '#df5d62';
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="shrink-0" aria-hidden="true">
      {kind === 'champion' ? (
        <path d="m3 6 3 3 4-6 4 6 3-3-1.5 9h-11Z" fill={color} />
      ) : (
        <><circle cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="1.5" /><path d={kind === 'promotion' ? 'm6 11 4-4 4 4M10 7v7' : 'm6 9 4 4 4-4M10 6v7'} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>
      )}
    </svg>
  );
}

const STORY_STAMPS: Record<StoryStampKind, { label: string; icon: IconName; tone: string }> = {
  derby: { label: '德比', icon: 'fire', tone: 'rivalry' },
  upset: { label: '爆冷', icon: 'bolt', tone: 'upset' },
  goalfest: { label: '进球大战', icon: 'ball', tone: 'danger' },
  final: { label: '决赛', icon: 'trophy', tone: 'honor' },
  penalties: { label: '点球决胜', icon: 'target', tone: 'warning' },
  comeback: { label: '逆转', icon: 'refresh', tone: 'success' },
  'late-winner': { label: '绝杀', icon: 'burst', tone: 'danger' },
};

export function StoryStamp({ kind, label }: { kind: StoryStampKind; label?: string }) {
  const stamp = STORY_STAMPS[kind];
  return (
    <span className="story-stamp" data-tone={stamp.tone}>
      <Icon name={stamp.icon} size={12} />
      <span>{label ?? stamp.label}</span>
    </span>
  );
}
