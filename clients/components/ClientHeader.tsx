'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { SupportedLanguage } from '../lib/types';
import { translations } from '../lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { Logo, buttonClasses } from './brand';

interface ClientHeaderProps {
  currentLang: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  showSignOut?: boolean;
}

// App bar: sits under the status bar (safe area) when installed as a PWA.
export function ClientHeader({
  currentLang,
  onLanguageChange,
  showSignOut = false,
}: ClientHeaderProps) {
  const t = translations[currentLang];

  return (
    <header className="sticky top-0 z-20 select-none border-b border-sand bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-240 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center" aria-label="My Fit Brain home">
          <Logo variant="horizontal" tone="colour" width={120} priority />
        </Link>

        <div className="flex items-center gap-1">
          <LanguageToggle currentLang={currentLang} onLanguageChange={onLanguageChange} />

          {showSignOut && (
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                aria-label={t.common.signOut}
                title={t.common.signOut}
                className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-3' })}
              >
                <LogOut size={18} strokeWidth={2} aria-hidden />
                <span className="hidden sm:inline">{t.common.signOut}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
