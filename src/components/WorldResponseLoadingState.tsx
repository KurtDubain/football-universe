export default function WorldResponseLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="world-response-loading"
      className="flex min-h-32 items-center gap-3 overflow-hidden border-y border-slate-700/60 px-3 sm:px-4"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-pulse rounded-full border border-emerald-400/60 bg-emerald-400/15 motion-reduce:animate-none"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-300">正在整理赛后回应</p>
        <div aria-hidden="true" className="mt-2 h-1.5 w-full max-w-56 animate-pulse rounded bg-slate-700/70 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
