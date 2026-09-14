
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={`${__APP_BRAND__.shortName}标志`}
      className="shrink-0"
    >
      <title>{__APP_BRAND__.fullName}</title>
      <rect x="3" y="3" width="58" height="58" rx="5" fill="#101511" stroke="#c9a25c" strokeWidth="2" />
      <path d="M9 9h46v31H9z" fill="#1f6845" stroke="#eee8d8" strokeWidth="1.2" />
      <path d="M32 9v31M9 24.5h46" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <circle cx="32" cy="24.5" r="5.2" fill="none" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <path d="M9 18h5v13H9m46-13h-5v13h5" fill="none" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <path d="M8 46h48M8 52h48" stroke="#c9a25c" strokeWidth="1" opacity=".55" />
      <path d="M16 57h32" stroke="#eee8d8" strokeWidth="1" opacity=".6" />
      <circle cx="54" cy="10" r="2" fill="#b8463e" />
    </svg>
  );
}
