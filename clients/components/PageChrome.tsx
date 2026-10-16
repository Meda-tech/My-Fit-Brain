'use client';

import { useLanguage } from './LanguageProvider';
import { ClientHeader } from './ClientHeader';
import { BottomNav } from './BottomNav';
import { cn } from './brand';

// App shell: sticky header with the EN | हिं toggle, content, and the bottom tab bar on the main
// screens. Focused flows (payment, assessment) hide the tab bar so nothing pulls the client away.
export function PageChrome({
  children,
  width = 'narrow',
  nav = true,
}: {
  children: React.ReactNode;
  /** narrow = 640px (app screens, assessment), report = 760px + padding */
  width?: 'narrow' | 'report';
  nav?: boolean;
}) {
  const { lang, setLang } = useLanguage();
  return (
    <div lang={lang} className="flex min-h-dvh flex-col bg-cream">
      <ClientHeader currentLang={lang} onLanguageChange={setLang} />
      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 pt-6 sm:px-6 sm:pt-10',
          width === 'narrow' ? 'max-w-160' : 'max-w-202',
          nav ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-[max(32px,env(safe-area-inset-bottom))]'
        )}
      >
        {children}
      </main>
      {nav && <BottomNav />}
    </div>
  );
}
