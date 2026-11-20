'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

// Right-side panel opened by the address (?open=…), so it can be reloaded or shared. Esc, the close
// button or the backdrop closes it by going back to the list address.
export function SidePanel({ title, closeHref, children }: { title: React.ReactNode; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => router.replace(closeHref, { scroll: false }), [router, closeHref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={close} className="absolute inset-0 bg-night/40" aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="side-panel-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-120 flex-col bg-white shadow-card"
      >
        <div className="flex items-start justify-between gap-3 border-b border-sand px-5 py-4">
          <h2 id="side-panel-title" className="m-0 min-w-0 text-[20px] font-semibold leading-7 text-teal">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}
