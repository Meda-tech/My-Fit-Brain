'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, UserRound } from 'lucide-react';
import { useLanguage } from './LanguageProvider';
import { translations } from '../lib/i18n';
import { cn } from './brand';

// App-style tab bar: two tabs, fixed to the bottom, above the home indicator on phones.
// Reports belong to Home (they are opened from "Your assessments").
export function BottomNav() {
  const pathname = usePathname();
  const { lang } = useLanguage();
  const t = translations[lang].nav;
  const tabs = [
    { href: '/', label: t.home, icon: House, active: pathname === '/' || pathname.startsWith('/report') },
    { href: '/profile', label: t.profile, icon: UserRound, active: pathname.startsWith('/profile') },
  ];

  return (
    <nav
      aria-label={t.label}
      className="fixed inset-x-0 bottom-0 z-30 select-none border-t border-sand bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex h-16 max-w-120 items-stretch">
        {tabs.map(({ href, label, icon: Icon, active }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-full flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors',
                active ? 'text-teal' : 'text-ink-muted hover:text-teal'
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-16 items-center justify-center rounded-full transition-colors',
                  active && 'bg-mist'
                )}
              >
                <Icon size={22} strokeWidth={2} aria-hidden />
              </span>
              <span className={active ? 'font-semibold' : undefined}>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
