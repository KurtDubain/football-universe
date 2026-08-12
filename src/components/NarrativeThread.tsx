import { Link } from 'react-router-dom';
import type { NarrativeThread as NarrativeThreadData, NarrativeThreadTone } from '../engine/observation/narrative-threads';
import { Icon, type IconName } from './Icon';

const TONE: Record<NarrativeThreadTone, { icon: IconName; border: string; text: string }> = {
  stage: { icon: 'trophy', border: 'border-amber-500/55', text: 'text-amber-300' },
  rise: { icon: 'trend-up', border: 'border-emerald-500/50', text: 'text-emerald-300' },
  fall: { icon: 'warning', border: 'border-rose-500/50', text: 'text-rose-300' },
  transfer: { icon: 'handshake', border: 'border-cyan-500/50', text: 'text-cyan-300' },
  neutral: { icon: 'clipboard', border: 'border-slate-600', text: 'text-slate-400' },
};

function ThreadEntry({ entry }: { entry: NarrativeThreadData['entries'][number] }) {
  const tone = TONE[entry.tone];
  const body = (
    <div className={`grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-l-2 py-2 pl-2 ${tone.border}`}>
      <Icon name={tone.icon} size={14} className={`mt-0.5 ${tone.text}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-slate-200">{entry.title}</span>
          <span className="text-[10px] text-slate-600">S{entry.season}</span>
          {entry.summaryOnly && <span className="text-[10px] text-slate-600">摘要</span>}
        </div>
        <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{entry.detail}</p>
      </div>
    </div>
  );
  return entry.to ? <Link to={entry.to} className="block hover:bg-slate-800/35">{body}</Link> : body;
}

export default function NarrativeThread({ thread }: { thread: NarrativeThreadData | null }) {
  if (!thread || thread.entries.length === 0) return null;
  const [lead, ...rest] = thread.entries;
  return (
    <section data-testid="entity-narrative-thread" data-thread-id={thread.id} className="border-y border-slate-700/60 bg-slate-950/20">
      <div className="flex min-h-11 items-center gap-2 px-3 py-2">
        <Icon name="clipboard" size={15} className="text-emerald-300" />
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-slate-200">{thread.title}</h3>
          <p className="truncate text-[10px] text-slate-600" title={thread.summary}>{thread.summary}</p>
        </div>
      </div>
      <div className="border-t border-slate-700/45 px-3">
        <ThreadEntry entry={lead} />
      </div>
      {rest.length > 0 && (
        <details className="border-t border-slate-700/45">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-slate-400 hover:text-slate-200">
            <Icon name="arrow-down" size={14} className="details-chevron" />
            <span>查看其余 {rest.length} 个节点</span>
          </summary>
          <div className="divide-y divide-slate-700/35 px-3 pb-1">
            {rest.map(entry => <ThreadEntry key={entry.id} entry={entry} />)}
          </div>
        </details>
      )}
    </section>
  );
}
