'use client';

import Link from 'next/link';
import { ChevronRight, ClipboardList, Lock } from 'lucide-react';
import { translations } from '../lib/i18n';
import { useLanguage } from '../components/LanguageProvider';
import { PageChrome } from '../components/PageChrome';
import { BinduDot, ButtonLink, Card, Pill } from '../components/brand';
import type { AttemptSummary, TestCard } from '../lib/assessment/server';
import type { LocalPair } from '../lib/assessment/types';

interface ClientHomeViewProps {
  firstName: string;
  tests: TestCard[];
  attempts: AttemptSummary[];
}

function formatDate(iso: string, lang: 'en' | 'hi'): string {
  return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function ClientHomeView({ firstName, tests, attempts }: ClientHomeViewProps) {
  const { lang } = useLanguage();
  const t = translations[lang];
  const local = (p: LocalPair | null) => (p ? (lang === 'hi' ? p.hi ?? p.en : p.en ?? p.hi) : null);

  const statusLabel: Record<AttemptSummary['status'], string> = {
    paid: t.assess.statusReady,
    in_progress: t.assess.statusInProgress,
    completed: t.assess.statusCompleted,
    stopped: t.assess.statusStopped,
  };

  return (
    <PageChrome>
      {/* Greeting */}
      <div className="mb-6">
        <BinduDot className="mb-3" />
        <h1 className="wrap-break-word text-[28px] font-semibold leading-tight text-teal sm:text-[34px]">
          {t.home.welcome} {firstName}
        </h1>
      </div>

      {/* Your assessments first: that is where a returning client continues. */}
      {attempts.length > 0 && (
        <section className="mb-8" aria-labelledby="your-assessments">
          <h2 id="your-assessments" className="mb-3 flex items-center gap-2 text-[20px] font-semibold text-teal">
            <ClipboardList size={20} strokeWidth={2} aria-hidden />
            <span>{t.assess.yourAssessments}</span>
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-sand">
              {attempts.map((a) => {
                const open = a.status === 'paid' || a.status === 'in_progress';
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{local(a.name)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                        <Pill tone={a.status === 'completed' ? 'mist' : 'quiet'}>{statusLabel[a.status]}</Pill>
                        {a.status === 'completed' && a.completedAt && (
                          <span>{t.assess.completedOn.replace('{date}', formatDate(a.completedAt, lang))}</span>
                        )}
                      </p>
                    </div>
                    {open && (
                      <span className="flex shrink-0 items-center gap-1 text-[14px] font-semibold text-teal">
                        {t.assess.continue}
                        <ChevronRight size={16} strokeWidth={2} aria-hidden />
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={a.id}>
                    {open ? (
                      <Link
                        href={`/assessment/${a.id}`}
                        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-mist/50 active:bg-mist"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-h-16 items-center gap-3 px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      {/* Start an assessment */}
      <section aria-labelledby="start-title">
        <h2 id="start-title" className="mb-3 text-[20px] font-semibold text-teal">
          {t.assess.startTitle}
        </h2>
        <div className="space-y-4">
          {tests.map((test) => (
            <Card key={test.code} className="flex flex-col p-5">
              <h3 className="text-[19px] font-semibold leading-snug text-ink">{local(test.name)}</h3>
              <p lang="en" className="mt-1 text-[13px] text-ink-muted">
                {t.brand.endorsement}
              </p>
              {test.subtitle && <p className="mt-3 text-[15px] leading-6 text-ink-soft">{local(test.subtitle)}</p>}
              <ButtonLink href={`/payment/${test.code}`} variant="secondary" className="mt-4 self-start">
                {t.assess.start}
              </ButtonLink>
            </Card>
          ))}
          {tests.length === 0 && <p className="text-[15px] text-ink-muted">{t.assess.none}</p>}
        </div>
      </section>

      <p className="mt-8 flex items-start gap-2 rounded-input bg-mist px-4 py-3 text-[14px] leading-5.5 text-ink-soft">
        <Lock size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        <span>{t.home.counsellingAssurance}</span>
      </p>
    </PageChrome>
  );
}
