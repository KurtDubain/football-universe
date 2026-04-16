/**
 * Simple team badge: colored shield shape with 1-2 character initial.
 * Each team gets a unique visual identity from their color + shortName.
 */
export default function TeamBadge({
  shortName,
  color,
  size = 32,
}: {
  shortName: string;
  color: string;
  size?: number;
}) {
  // Take first 1-2 chars
  const label = shortName.slice(0, 2);
  const fs = size * 0.35;
  const dark = darken(color, 0.4);

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0">
      {/* Shield shape */}
      <path
        d="M20 2 L36 10 L36 24 Q36 36 20 38 Q4 36 4 24 L4 10 Z"
        fill={color}
        opacity="0.9"
      />
      {/* Inner shadow */}
      <path
        d="M20 5 L33 12 L33 24 Q33 34 20 36 Q7 34 7 24 L7 12 Z"
        fill={dark}
        opacity="0.3"
      />
      {/* Stripe accent */}
      <rect x="18" y="2" width="4" height="36" fill="white" opacity="0.08" rx="2" />
      {/* Text */}
      <text
        x="20"
        y="23"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontFamily="Arial,sans-serif"
        fontSize={fs}
        fontWeight="900"
        letterSpacing="-0.5"
      >
        {label}
      </text>
    </svg>
  );
}

function darken(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r * (1 - amount));
  const ng = Math.round(g * (1 - amount));
  const nb = Math.round(b * (1 - amount));
  return `rgb(${nr},${ng},${nb})`;
}
