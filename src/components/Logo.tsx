export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e3a5f" />
        </linearGradient>
        <linearGradient id="logo-ball" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      {/* Shield */}
      <path
        d="M32 2 L56 14 L56 38 Q56 54 32 62 Q8 54 8 38 L8 14 Z"
        fill="url(#logo-bg)"
        stroke="#3b82f6"
        strokeWidth="2"
      />
      {/* Football */}
      <circle cx="32" cy="28" r="12" fill="url(#logo-ball)" stroke="#475569" strokeWidth="0.8" />
      <path d="M32 20 L37 24 L35 30 L29 30 L27 24 Z" fill="#334155" stroke="#475569" strokeWidth="0.6" />
      <path d="M37 24 L42 28 L40 34 L35 30 Z" fill="#334155" stroke="#475569" strokeWidth="0.6" />
      <path d="M27 24 L22 28 L24 34 L29 30 Z" fill="#334155" stroke="#475569" strokeWidth="0.6" />
      {/* Star */}
      <polygon
        points="32,6 33,9 36,9 33.5,11 34.5,14 32,12 29.5,14 30.5,11 28,9 31,9"
        fill="#fbbf24"
      />
      <circle cx="18" cy="10" r="1.2" fill="#fbbf24" opacity="0.7" />
      <circle cx="46" cy="10" r="1.2" fill="#fbbf24" opacity="0.7" />
      {/* Text */}
      <text
        x="32" y="48"
        textAnchor="middle"
        fill="#3b82f6"
        fontFamily="Arial,Helvetica,sans-serif"
        fontSize="6"
        fontWeight="900"
        letterSpacing="1"
      >
        FLU
      </text>
      <text
        x="32" y="55"
        textAnchor="middle"
        fill="#64748b"
        fontFamily="Arial,Helvetica,sans-serif"
        fontSize="3.5"
      >
        UNIVERSE
      </text>
    </svg>
  );
}
