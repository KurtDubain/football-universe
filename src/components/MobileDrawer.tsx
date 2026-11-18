import { type ReactNode, useRef } from 'react';
import { useFocusTrap } from './use-focus-trap';

export default function MobileDrawer({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 抽屉挂在页面树内，背景不能置 inert，否则会连抽屉自己一起屏蔽掉。
  useFocusTrap(panelRef, { active: open, onEscape: onClose });

  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-[220] flex">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="mobile-drawer-panel w-64 max-w-[calc(100vw-3rem)] bg-slate-800 flex flex-col shadow-2xl"
      >
        {children}
      </div>
      <div className="flex-1 bg-black/60" aria-hidden="true" onClick={onClose} />
    </div>
  );
}
