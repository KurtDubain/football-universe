import { CSSProperties, ReactElement } from 'react';

/**
 * v4.7 — Custom SVG icon set for 足球联赛宇宙.
 *
 * Why hand-rolled instead of an icon library:
 *   - Bundle weight: ~40 inline icons we actually use, no tree-shake gymnastics
 *   - Visual unity: every icon shares the same stroke weight, corner radius,
 *     and 24×24 viewBox so they read as a deliberate set
 *   - Theme-able: stroke uses `currentColor` so an icon picks up the parent
 *     text colour automatically; an optional `accent` prop lights a fill
 *     for special cases (gold trophy, red card, yellow card)
 *   - Cross-platform consistency: emoji rendered very differently on
 *     iOS / Android / Windows; SVG looks identical everywhere
 *
 * Style guide (keep changes consistent with existing icons):
 *   - viewBox: always `0 0 24 24`
 *   - stroke: 1.75, round caps + joins, `currentColor`
 *   - filled regions: only when conceptually solid (star, dot, trophy cup)
 *   - keep decorative micro-detail OUT — readability at 16px is critical
 *
 * Adding a new icon: push to `IconName` union below and add a case in
 * `renderIcon()`. Tests are not necessary for icons (visual change).
 */

export type IconName =
  | 'trophy'   | 'ball'        | 'star'    | 'star-glow'
  | 'fire'     | 'stadium'     | 'check'   | 'x'
  | 'shield'   | 'bolt'        | 'building'| 'crown'
  | 'rocket'   | 'target'      | 'burst'   | 'arrow-up'
  | 'arrow-down' | 'medal'     | 'bandage' | 'flex'
  | 'warning'  | 'clipboard'   | 'chart'   | 'megaphone'
  | 'news'     | 'tie'         | 'trend-up'| 'tophat'
  | 'backpack' | 'refresh'     | 'speech'  | 'outbox'
  | 'inbox'    | 'dice'        | 'coin'    | 'cart'
  | 'money'    | 'gloves'      | 'boot'    | 'play'
  | 'sparkle'  | 'handshake'   | 'eye'     | 'lock'
  | 'gem'      | 'leaf'        | 'mortarboard';

interface IconProps {
  name: IconName;
  size?: number | string;
  className?: string;
  /** Optional accent fill for icons that benefit from a colour pop
   *  (e.g. trophy gold, fire orange, star yellow). When omitted the icon
   *  is pure currentColor stroke. */
  accent?: string;
  style?: CSSProperties;
  title?: string;
}

const SW = 1.75; // shared stroke width

export function Icon({ name, size = '1em', className, accent, style, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={SW}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={!title}
    >
      {title && <title>{title}</title>}
      {renderIcon(name, accent)}
    </svg>
  );
}

function renderIcon(name: IconName, accent?: string): ReactElement {
  switch (name) {
    case 'trophy':
      // Cup with side handles, base, and stem
      return (
        <>
          <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" fill={accent ?? 'none'} />
          <path d="M7 6H4a2 2 0 0 0 0 4h3" />
          <path d="M17 6h3a2 2 0 0 1 0 4h-3" />
          <path d="M12 13v4" />
          <path d="M9 19h6" strokeWidth={SW + 0.5} />
        </>
      );
    case 'ball':
      // Football with central pentagon + lines
      return (
        <>
          <circle cx="12" cy="12" r="9" fill={accent ?? 'none'} />
          <path d="M12 7l3.5 2.5-1.3 4.1h-4.4L8.5 9.5 12 7z" />
          <path d="M12 7V3.5M15.5 9.5l3.4-1.1M14.2 13.6l2.8 2.4M9.8 13.6l-2.8 2.4M8.5 9.5L5.1 8.4" />
        </>
      );
    case 'star':
      // Solid 5-point star
      return (
        <path
          d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6L12 16.9 6.6 19.7l1-6L3.2 9.4l6.1-.9L12 3z"
          fill={accent ?? 'currentColor'}
          fillOpacity="0.9"
        />
      );
    case 'star-glow':
      // 4-point star with rays (signature / standout)
      return (
        <>
          <path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5L12 4z" fill={accent ?? 'none'} />
          <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" />
        </>
      );
    case 'fire':
      // Flame with inner core
      return (
        <>
          <path
            d="M12 3c1 3 3 4.5 3 8a3 3 0 0 1-6 0c0-1.5.5-2 1-2.5C8 11 6 13 6 16a6 6 0 0 0 12 0c0-4-3-6-6-13z"
            fill={accent ?? 'none'}
            fillOpacity="0.4"
          />
          <path d="M10.5 16.5a1.5 1.5 0 0 0 3 0c0-1-.5-1.5-1.5-2.5-1 1-1.5 1.5-1.5 2.5z" />
        </>
      );
    case 'stadium':
      // Oval pitch top-down
      return (
        <>
          <ellipse cx="12" cy="12" rx="9" ry="5" />
          <path d="M12 7v10" />
          <circle cx="12" cy="12" r="2" />
          <path d="M3 12h2M19 12h2" />
        </>
      );
    case 'check':
      return <path d="M5 12.5L10 17.5L19 7" strokeWidth={SW + 0.25} />;
    case 'x':
      return (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6l-12 12" />
        </>
      );
    case 'shield':
      // Defensive crest
      return (
        <path
          d="M12 3l8 3v6c0 4.5-3 8-8 9-5-1-8-4.5-8-9V6l8-3z"
          fill={accent ?? 'none'}
          fillOpacity="0.3"
        />
      );
    case 'bolt':
      return (
        <path
          d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
          fill={accent ?? 'none'}
          fillOpacity="0.5"
        />
      );
    case 'building':
      // Classical hall with columns (history / hall of fame)
      return (
        <>
          <path d="M3 9l9-5 9 5" />
          <path d="M5 9v9M9 9v9M15 9v9M19 9v9" />
          <path d="M3 21h18" strokeWidth={SW + 0.25} />
          <path d="M3 18h18" />
        </>
      );
    case 'crown':
      return (
        <>
          <path
            d="M3 8l3 9h12l3-9-5 3-4-6-4 6-5-3z"
            fill={accent ?? 'none'}
            fillOpacity="0.3"
          />
          <circle cx="3" cy="8" r="1" fill="currentColor" />
          <circle cx="21" cy="8" r="1" fill="currentColor" />
          <circle cx="12" cy="4" r="1" fill="currentColor" />
        </>
      );
    case 'rocket':
      return (
        <>
          <path d="M14 5c4 1 5 5 5 5s-4-1-5-5z" fill={accent ?? 'none'} />
          <path d="M5 19c-1-3 1-7 4-9l5 5c-2 3-6 5-9 4z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M9 15l-3 3" />
          <circle cx="14" cy="10" r="1.2" fill="currentColor" />
        </>
      );
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.8" fill={accent ?? 'currentColor'} />
        </>
      );
    case 'burst':
      // Sunburst lines emanating from a dot
      return (
        <>
          <circle cx="12" cy="12" r="2.5" fill={accent ?? 'currentColor'} />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        </>
      );
    case 'arrow-up':
      return (
        <>
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </>
      );
    case 'arrow-down':
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12l7 7 7-7" />
        </>
      );
    case 'medal':
      return (
        <>
          <path d="M8 2l4 6 4-6" />
          <circle cx="12" cy="15" r="6" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M12 12v6M9.5 14.5l5 1M14.5 14.5l-5 1" />
        </>
      );
    case 'bandage':
      // Diagonal bandage
      return (
        <>
          <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-30 12 12)" />
          <circle cx="9.5" cy="14" r="0.6" fill="currentColor" />
          <circle cx="11" cy="11.5" r="0.6" fill="currentColor" />
          <circle cx="13" cy="12.5" r="0.6" fill="currentColor" />
          <circle cx="14.5" cy="10" r="0.6" fill="currentColor" />
        </>
      );
    case 'flex':
      // Bicep arm
      return (
        <path d="M5 14c2-3 4-2 6 0s4 4 8 0c-1 4-4 6-8 6s-7-3-6-6z" fill={accent ?? 'none'} fillOpacity="0.3" />
      );
    case 'warning':
      return (
        <>
          <path d="M12 3l9 16H3l9-16z" fill={accent ?? 'none'} fillOpacity="0.2" />
          <path d="M12 10v4M12 17v.5" strokeWidth={SW + 0.25} />
        </>
      );
    case 'clipboard':
      return (
        <>
          <rect x="5" y="5" width="14" height="16" rx="2" />
          <path d="M9 3h6v4H9z" fill={accent ?? 'none'} />
          <path d="M9 12h6M9 16h4" />
        </>
      );
    case 'chart':
      // Bar chart
      return (
        <>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </>
      );
    case 'megaphone':
      return (
        <>
          <path d="M3 11v2l11 5V6L3 11z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M14 8v8l5-1V9l-5-1z" />
          <path d="M7 13v3a2 2 0 0 0 4 0v-2" />
        </>
      );
    case 'news':
      // Folded newspaper
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M3 9h18" />
          <path d="M7 12h5M7 15h5" />
          <rect x="14" y="11.5" width="4" height="4" rx="0.5" />
        </>
      );
    case 'tie':
      // Necktie (coach)
      return (
        <>
          <path d="M9 3h6l-1 4 2 12-4 2-4-2 2-12-1-4z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M10 7h4" />
        </>
      );
    case 'trend-up':
      return (
        <>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M16 7h5v5" />
        </>
      );
    case 'tophat':
      // Top hat (legends / classy)
      return (
        <>
          <rect x="6" y="4" width="12" height="11" rx="1" fill={accent ?? 'none'} fillOpacity="0.3" />
          <rect x="3" y="14" width="18" height="3" rx="1" />
          <path d="M6 8h12" />
        </>
      );
    case 'backpack':
      // School bag (young / academy)
      return (
        <>
          <path d="M7 8c0-3 2-5 5-5s5 2 5 5v13H7V8z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M9 8c0-2 1.5-3 3-3s3 1 3 3" />
          <path d="M9 14h6" />
          <rect x="10" y="11" width="4" height="2" rx="0.3" fill="currentColor" />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path d="M3 21v-5h5M21 3v5h-5" />
        </>
      );
    case 'speech':
      // Counter-offer / discussion bubble
      return (
        <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill={accent ?? 'none'} fillOpacity="0.2" />
      );
    case 'outbox':
      return (
        <>
          <path d="M3 13l9 5 9-5" />
          <path d="M12 18V4" />
          <path d="M8 8l4-4 4 4" />
        </>
      );
    case 'inbox':
      return (
        <>
          <path d="M3 11l9-5 9 5" />
          <path d="M12 6v14" />
          <path d="M8 16l4 4 4-4" />
        </>
      );
    case 'dice':
      // 5-pip die face
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" fill={accent ?? 'none'} fillOpacity="0.2" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
          <circle cx="16" cy="8" r="1" fill="currentColor" />
          <circle cx="8" cy="16" r="1" fill="currentColor" />
          <circle cx="16" cy="16" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </>
      );
    case 'coin':
      return (
        <>
          <circle cx="12" cy="12" r="9" fill={accent ?? 'none'} fillOpacity="0.4" />
          <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-4a1.5 1.5 0 0 0 0 3h4" />
        </>
      );
    case 'cart':
      return (
        <>
          <path d="M3 4h2l2 12h11l2-8H6" />
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="17" cy="20" r="1.5" />
        </>
      );
    case 'money':
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="1.5" fill={accent ?? 'none'} fillOpacity="0.3" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M3 9h18M3 15h18" />
        </>
      );
    case 'gloves':
      // Goalkeeper gloves
      return (
        <>
          <path d="M7 8c0-2 1-4 5-4s5 2 5 4v8a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M10 6v3M14 6v3M9 10v2M15 10v2" />
        </>
      );
    case 'boot':
      // Football boot (golden boot)
      return (
        <>
          <path d="M3 18l1-7c.2-2 1.5-3 3-3l8-2 6 2-1 6c-.5 2-2 3-4 3H5a2 2 0 0 1-2-2z" fill={accent ?? 'none'} fillOpacity="0.4" />
          <path d="M7 12h2M11 11h2M15 11h2" />
        </>
      );
    case 'play':
      return (
        <path d="M7 4l13 8-13 8V4z" fill={accent ?? 'currentColor'} />
      );
    case 'sparkle':
      // 4-point sparkle for "new" / fresh
      return (
        <>
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" fill={accent ?? 'currentColor'} />
          <path d="M19 16l.6 1.6L21 18l-1.4.4L19 20l-.4-1.6L17 18l1.6-.4L19 16z" fill={accent ?? 'currentColor'} fillOpacity="0.6" />
        </>
      );
    case 'handshake':
      return (
        <>
          <path d="M3 11h4l3-3 4 3 3-1 4 1" />
          <path d="M3 11l5 5c1 1 2 1 3 0l4-4" />
          <path d="M21 11l-5 5c-1 1-2 1-3 0" />
        </>
      );
    case 'eye':
      return (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill={accent ?? 'none'} fillOpacity="0.2" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="11" width="14" height="10" rx="1.5" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </>
      );
    case 'gem':
      // Diamond
      return (
        <path d="M12 3l5 5-5 13L7 8l5-5z" fill={accent ?? 'none'} fillOpacity="0.4" />
      );
    case 'leaf':
      return (
        <path d="M5 19c0-9 5-15 14-15-1 9-7 15-14 15zM5 19l8-8" fill={accent ?? 'none'} fillOpacity="0.3" />
      );
    case 'mortarboard':
      // Graduation cap
      return (
        <>
          <path d="M2 9l10-4 10 4-10 4L2 9z" fill={accent ?? 'none'} fillOpacity="0.3" />
          <path d="M6 11v5c0 1 3 2 6 2s6-1 6-2v-5" />
          <path d="M22 9v4" />
        </>
      );
    default:
      // Fallback: simple square placeholder so a typo doesn't crash
      return <rect x="4" y="4" width="16" height="16" rx="2" />;
  }
}
