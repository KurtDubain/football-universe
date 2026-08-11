export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="足球联赛宇宙标志"
      className="shrink-0"
    >
      <title>足球联赛宇宙</title>
      <rect x="3" y="3" width="58" height="58" rx="5" fill="#101511" stroke="#c9a25c" strokeWidth="2" />
      <path d="M9 9h46v31H9z" fill="#1f6845" stroke="#eee8d8" strokeWidth="1.2" />
      <path d="M32 9v31M9 24.5h46" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <circle cx="32" cy="24.5" r="5.2" fill="none" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <path d="M9 18h5v13H9m46-13h-5v13h5" fill="none" stroke="#eee8d8" strokeWidth="1" opacity=".8" />
      <path d="M8 46h48M8 52h48" stroke="#c9a25c" strokeWidth="1" opacity=".55" />
      <path d="M13 56V44h10v2.6h-6.8v2.2h5.9v2.5h-5.9V56Zm15 0V44h3.2v9.3h6.3V56Z" fill="#eee8d8" />
      <path d="M42 44v7.2c0 1.5.8 2.3 2.4 2.3s2.4-.8 2.4-2.3V44H50v7.4c0 3.2-2.1 5-5.6 5s-5.6-1.8-5.6-5V44Z" fill="#c9a25c" />
      <circle cx="54" cy="10" r="2" fill="#b8463e" />
    </svg>
  );
}
