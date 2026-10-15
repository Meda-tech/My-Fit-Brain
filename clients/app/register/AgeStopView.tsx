'use client';

import { translations, Language } from '../../lib/i18n';
import { LanguageToggle } from '../../components/LanguageToggle';
import { Button, Card, Footer, Logo } from '../../components/brand';

interface AgeStopViewProps {
  lang: Language;
  onLanguageChange: (lang: Language) => void;
}

const TELE_MANAS = '14416';

// AGE_STOP (question bank, Flags & Safety): full screen, nothing saved. "Close" signs the user out.
export function AgeStopView({ lang, onLanguageChange }: AgeStopViewProps) {
  const t = translations[lang];
  const body = t.ageStop.body;

  // The Tele-MANAS number becomes a tap-to-call link; the text itself is unchanged.
  const at = body.lastIndexOf(TELE_MANAS);
  const before = at >= 0 ? body.slice(0, at) : body;
  const after = at >= 0 ? body.slice(at + TELE_MANAS.length) : '';

  return (
    <div lang={lang} className="flex min-h-screen flex-col bg-cream">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)] [box-sizing:content-box] sm:px-8">
        <Logo variant="horizontal" tone="colour" width={120} priority />
        <LanguageToggle currentLang={lang} onLanguageChange={onLanguageChange} />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <Card className="w-full max-w-[520px] p-6 text-center sm:p-10">
          <p role="status" className="text-[17px] leading-[28px] text-ink-soft">
            {before}
            {at >= 0 && (
              <a
                href={`tel:${TELE_MANAS}`}
                className="font-semibold text-teal underline underline-offset-2"
              >
                {TELE_MANAS}
              </a>
            )}
            {after}
          </p>

          <form action="/api/auth/signout" method="POST" className="mt-8">
            <Button type="submit" fullWidth>
              {t.ageStop.close}
            </Button>
          </form>
        </Card>
      </main>

      <Footer className="standalone:hidden" />
    </div>
  );
}
