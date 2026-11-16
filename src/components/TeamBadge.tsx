import { useId } from 'react';
import {
  BADGE_NAMEPLATE_PATH,
  BADGE_PATTERN_SHAPES,
  BADGE_SASH_PATH,
  BADGE_SYMBOL_PATHS,
  BADGE_VIEWBOX,
  badgeShade,
  teamBadgeParts,
} from './team-badge-geometry';

interface TeamBadgeProps {
  shortName: string;
  color: string;
  size?: number;
  teamId?: string;
  title?: string;
}

export default function TeamBadge({
  shortName,
  color,
  size = 32,
  teamId,
  title,
}: TeamBadgeProps) {
  const parts = teamBadgeParts(teamId, shortName);
  const clipId = `team-badge-${useId().replace(/:/g, '')}`;
  const dark = badgeShade(color, -0.52);
  const light = badgeShade(color, 0.34);
  const label = parts.label;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BADGE_VIEWBOX} ${BADGE_VIEWBOX}`}
      className="team-badge shrink-0"
      role="img"
      aria-label={title ?? `${shortName}队徽`}
    >
      <title>{title ?? `${shortName}队徽`}</title>
      <defs>
        <clipPath id={clipId}><path d={parts.frame} /></clipPath>
      </defs>

      <path d={parts.frame} fill={dark} stroke="rgba(255,255,255,.46)" strokeWidth="1.25" />
      <g clipPath={`url(#${clipId})`}>
        <rect width={BADGE_VIEWBOX} height={BADGE_VIEWBOX} fill={color} />
        {BADGE_PATTERN_SHAPES[parts.patternIndex].map((shape, index) => (
          <path
            key={`pattern-${index}`}
            d={shape.d}
            fill={shape.tone === 'light' ? light : dark}
            opacity={shape.opacity}
          />
        ))}
        <path d={BADGE_SASH_PATH} fill={dark} opacity=".26" />
      </g>
      <path d={parts.frame} fill="none" stroke={dark} strokeWidth="2.2" opacity=".72" />
      <path d={parts.frame} fill="none" stroke="rgba(255,255,255,.44)" strokeWidth=".75" />

      <g fill="none" stroke="rgba(255,255,255,.32)" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        {BADGE_SYMBOL_PATHS[parts.symbolIndex].map((d, index) => (
          <path key={`symbol-${index}`} d={d} />
        ))}
      </g>
      <path d={BADGE_NAMEPLATE_PATH} fill={dark} opacity=".82" />
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