'use client';

import { useLanguage } from './LanguageProvider';
import { ClientHeader } from './ClientHeader';
import { Footer } from './brand';
import { cn } from './brand';

// Sticky header with the EN | हिं toggle around server-rendered content.
export function PageChrome({
  children,
  width = 'narrow',
  footer = true,
}: {
  children: React.ReactNode;
  /** narrow = 640px (assessment), report = 760px, wide = 960px */
  width?: 'narrow' | 'report' | 'wide';
  footer?: boolean;
}) {
  const { lang, setLang } = useLanguage();
  return (
    <div lang={lang} className="flex min-h-screen flex-col bg-cream">
      <ClientHeader currentLang={lang} onLanguageChange={setLang} showSignOut />
      <main
        className={cn(
          'mx-auto w-full flex-1 px-4 pb-[max(32px,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:py-10',
          width === 'narrow' ? 'max-w-[640px]' : width === 'report' ? 'max-w-[808px]' : 'max-w-[960px]'
        )}
      >
        {children}
      </main>
      {footer && <Footer className="standalone:hidden" />}
    </div>
  );
}
