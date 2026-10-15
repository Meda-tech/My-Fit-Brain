'use client';

import { Lock, Languages, Sprout, LogOut } from 'lucide-react';
import { translations, Language } from '../lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { Footer, Logo, buttonClasses, cn } from './brand';

interface ClientAuthLayoutProps {
  lang: Language;
  onLanguageChange: (lang: Language) => void;
  showSignOut?: boolean;
  /** Wider form column, for multi-field forms. */
  wide?: boolean;
  children: React.ReactNode;
}

const POINT_ICONS = [Lock, Languages, Sprout];

// Split layout for login and registration: brand panel (desktop) + form column.
export function ClientAuthLayout({
  lang,
  onLanguageChange,
  showSignOut = false,
  wide = false,
  children,
}: ClientAuthLayoutProps) {
  const t = translations[lang];

  return (
    <div lang={lang} className="grid min-h-screen bg-cream lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-night text-white lg:flex lg:flex-col lg:justify-between lg:gap-12 lg:p-12 xl:p-16">
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 opacity-[0.08]">
          <Logo variant="icon" tone="white" width={420} />
        </div>

        <Logo variant="horizontal" tone="reverse" width={160} priority />

        <div className="relative max-w-[440px]">
          <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-mist">
            {t.panel.eyebrow}
          </p>
          {/* Brand line stays in English in both languages */}
          <h2 lang="en" className="mt-3 text-[40px] font-semibold leading-[1.15] text-coral-light xl:text-[48px]">
            Space to speak.
          </h2>
          <p className="mt-4 text-[17px] leading-[27px] text-mist">{t.panel.body}</p>

          <ul className="mt-8 space-y-4">
            {t.panel.points.map((text, i) => {
              const Icon = POINT_ICONS[i] ?? Lock;
              return (
                <li key={text} className="flex items-center gap-3 text-[15px] text-white">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-mist">
                    <Icon size={18} strokeWidth={2} aria-hidden />
                  </span>
                  {text}
                </li>
              );
            })}
          </ul>
        </div>

        <p lang="en" className="relative text-[14px] text-mist">
          Designed by Dr. Neha Mehta
        </p>
      </aside>

      {/* Form column */}
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] [box-sizing:content-box] select-none sm:px-8">
          <span className="lg:invisible">
            <Logo variant="horizontal" tone="colour" width={120} priority />
          </span>
          <div className="flex items-center gap-1">
            <LanguageToggle currentLang={lang} onLanguageChange={onLanguageChange} />
            {showSignOut && (
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'px-3' })}
                  title={t.common.signOut}
                >
                  <LogOut size={18} strokeWidth={2} aria-hidden />
                  <span className="hidden sm:inline">{t.common.signOut}</span>
                </button>
              </form>
            )}
          </div>
        </header>

        <main className="flex flex-1 items-start justify-center px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 sm:items-center sm:px-8 sm:py-10">
          <div className={cn('w-full', wide ? 'max-w-[540px]' : 'max-w-[440px]')}>{children}</div>
        </main>

        <Footer bordered={false} className="standalone:hidden" />
      </div>
    </div>
  );
}
