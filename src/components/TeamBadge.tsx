import { useId } from 'react';

interface TeamBadgeProps {
  shortName: string;
  color: string;
  size?: number;
  teamId?: string;
  title?: string;
}

const FRAME_PATHS = [
  'M20 2 36 9v14c0 8-5.7 13.2-16 15C9.7 36.2 4 31 4 23V9Z',
  'M20 2 34 6.5 37 20 31 34 20 39 9 34 3 20 6 6.5Z',
  'M20 2 34 7v18c0 6.5-5.3 11.2-14 14-8.7-2.8-14-7.5-14-14V7Z',
  'M20 2 35 11l-2 18-13 10L7 29 5 11Z',
  'M20 2 32 5l6 11-4 16-14 7L6 32 2 16 8 5Z',
  'M20 2c9.4 0 17 6.5 17 15.3C37 28.8 29.6 36 20 39 10.4 36 3 28.8 3 17.3 3 8.5 10.6 2 20 2Z',
] as const;

export default function TeamBadge({
  shortName,
  color,
  size = 32,
  teamId,
  title,
}: TeamBadgeProps) {
  const seed = hashString(teamId || shortName);
  const frame = FRAME_PATHS[seed % FRAME_PATHS.length];
  const symbol = (seed >>> 3) % 12;
  const pattern = (seed >>> 7) % 4;
  const label = shortName.slice(0, 2);
  const clipId = `team-badge-${useId().replace(/:/g, '')}`;
  const dark = shade(color, -0.52);
  const light = shade(color, 0.34);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className="team-badge shrink-0"
      role="img"
      aria-label={title ?? `${shortName}队徽`}
    >
      <title>{title ?? `${shortName}队徽`}</title>
      <defs>
        <clipPath id={clipId}><path d={frame} /></clipPath>
      </defs>

      <path d={frame} fill={dark} stroke="rgba(255,255,255,.46)" strokeWidth="1.25" />
      <g clipPath={`url(#${clipId})`}>
        <rect width="40" height="40" fill={color} />
        <BadgePattern variant={pattern} dark={dark} light={light} />
        <path d="M-2 34 42 9v9L-2 43Z" fill={dark} opacity=".26" />
      </g>
      <path d={frame} fill="none" stroke={dark} strokeWidth="2.2" opacity=".72" />
      <path d={frame} fill="none" stroke="rgba(255,255,255,.44)" strokeWidth=".75" />

      <g fill="none" stroke="rgba(255,255,255,.32)" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        <BadgeSymbol variant={symbol} />
      </g>
      <path d="M8 24.5h24v8.2c-3 3.1-7 5.2-12 6.3-5-1.1-9-3.2-12-6.3Z" fill={dark} opacity=".82" />
      <text
        x="20"
        y="29.2"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontFamily="Inter,Arial,sans-serif"
        fontSize={label.length > 1 ? 8.4 : 10}
        fontWeight="800"
      >
        {label}
      </text>
    </svg>
  );
}

function BadgePattern({ variant, dark, light }: { variant: number; dark: string; light: string }) {
  if (variant === 0) {
    return <><rect x="8" width="7" height="40" fill={light} opacity=".24" /><rect x="25" width="7" height="40" fill={dark} opacity=".28" /></>;
  }
  if (variant === 1) {
    return <><path d="M0 7h40v7H0zm0 14h40v7H0z" fill={light} opacity=".2" /></>;
  }
  if (variant === 2) {
    return <><path d="M-8 5 9-5l39 27-17 10Z" fill={light} opacity=".2" /><path d="m-8 22 17-10 39 27-17 10Z" fill={dark} opacity=".22" /></>;
  }
  return <><path d="M20-2 42 20 20 42-2 20Z" fill={light} opacity=".18" /><circle cx="20" cy="18" r="10" fill={dark} opacity=".2" /></>;
}

function BadgeSymbol({ variant }: { variant: number }) {
  switch (variant) {
    case 0: return <path d="m20 7 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7Z" />;
    case 1: return <path d="m20 7 7 8-7 8-7-8Z" />;
    case 2: return <path d="m12 20 8-12 8 12m-13-4h10" />;
    case 3: return <><path d="M13 21V11h14v10" /><path d="m13 11 3-4 4 4 4-4 3 4" /></>;
    case 4: return <><path d="M11 19c3-6 6-8 9-8s6 2 9 8" /><path d="M14 19c2-3 4-4 6-4s4 1 6 4" /></>;
    case 5: return <><path d="M14 21V9h12v12M11 13h18" /><path d="M18 9V6h4v3" /></>;
    case 6: return <path d="m10 20 7-10 4 6 3-4 6 8" />;
    case 7: return <><path d="M10 11c4 0 4 4 8 4s4-4 8-4 4 4 8 4" /><path d="M8 19c4 0 4-4 8-4" /></>;
    case 8: return <><circle cx="20" cy="14" r="5" /><path d="M20 5v3m0 12v3m9-9h-3m-12 0h-3m15.4-6.4-2.1 2.1m-8.6 8.6-2.1 2.1" /></>;
    case 9: return <path d="m23 5-9 11h6l-3 8 10-12h-6Z" />;
    case 10: return <><circle cx="20" cy="14" r="7" /><path d="m20 7 4 5-2 6h-4l-2-6Z" /></>;
    default: return <><path d="M11 8h18M13 12h14M15 16h10" /><path d="M20 6v16" /></>;
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shade(input: string, amount: number): string {
  const match = input.match(/^#([\da-f]{6})$/i);
  if (!match) return amount < 0 ? '#111820' : '#dce5ec';
  const value = Number.parseInt(match[1], 16);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  const channel = (shift: number) => Math.round(((value >> shift) & 255) * (1 - ratio) + target * ratio);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}
