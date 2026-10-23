'use client';

import { useState, useSyncExternalStore } from 'react';
import { Download, Share, X } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { SupportedLanguage } from '../lib/types';
import { buttonClasses } from './brand';

// "Install app" in the header, for clients who skipped the browser's own install pop-up. That pop-up
// stays: the event is kept for later, never cancelled. Hidden once the app runs installed.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captured at module load so the event is not missed if it fires before this component mounts.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const noSubscribe = () => () => {};

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iPhone / iPad Safari: no install event; the client adds it from the Share menu.
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function InstallAppButton({ lang }: { lang: SupportedLanguage }) {
  const t = translations[lang].install;
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  // Device facts never change while the page is open; 'server' while rendering on the server.
  const device = useSyncExternalStore(
    noSubscribe,
    () => (isStandalone() ? 'installed' : isIos() ? 'ios' : 'other'),
    () => 'server'
  );
  const [showIosHelp, setShowIosHelp] = useState(false);

  const mode =
    device === 'installed' || device === 'server' ? 'hidden' : prompt ? 'prompt' : device === 'ios' ? 'ios' : 'hidden';
  if (mode === 'hidden') return null;

  const onClick = async () => {
    if (mode === 'ios') {
      setShowIosHelp(true);
      return;
    }
    if (!deferred) return;
    const event = deferred;
    await event.prompt();
    await event.userChoice;
    // An install event can be used once; the browser sends a new one if the client may try again.
    deferred = null;
    notify();
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={t.button}
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-3' })}
      >
        <Download size={18} strokeWidth={2} aria-hidden />
        <span className="hidden min-[380px]:inline">{t.button}</span>
      </button>

      {showIosHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-night/50 p-4 sm:items-center"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="w-full max-w-100 rounded-card border border-sand bg-white p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="install-title" className="text-[20px] font-semibold text-teal">
                {t.title}
              </h2>
              <button
                type="button"
                onClick={() => setShowIosHelp(false)}
                aria-label={t.close}
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-mist"
              >
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <p className="mt-3 flex items-start gap-3 text-[16px] leading-6 text-ink-soft">
              <Share size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
              <span>{t.iosSteps}</span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
