'use client';

import Link from 'next/link';
import { CheckCircle2, ChevronRight, ClipboardList, Lock, User } from 'lucide-react';
import { ClientRecord } from '../lib/types';
import { isGender, isRelationshipStatus } from '../lib/options';
import { translations } from '../lib/i18n';
import { useLanguage } from '../components/LanguageProvider';
import { ClientHeader } from '../components/ClientHeader';
import { formatDisplayPhone } from '../lib/phone';
import { ButtonLink, Card, Footer, Pill } from '../components/brand';
import type { AttemptSummary, TestCard } from '../lib/assessment/server';
import type { LocalPair } from '../lib/assessment/types';

interface ClientHomeViewProps {
  client: ClientRecord;
  tests: TestCard[];
  attempts: AttemptSummary[];
}

type Copy = (typeof translations)['en'];

// Stored values are English keys; show them in the chosen language.
// Unknown values (should not exist after the migration) are shown as stored.
function genderLabel(t: Copy, gender: string): string {
  return isGender(gender) ? t.options.gender[gender] : gender;
}

function relationshipLabel(t: Copy, status: string): string {
  return isRelationshipStatus(status) ? t.options.relationship[status] : status;
}

export function ClientHomeView({ client, tests, attempts }: ClientHomeViewProps) {
  const { lang, setLang } = useLanguage();
  const t = translations[lang];
  const local = (p: LocalPair | null) => (p ? (lang === 'hi' ? p.hi ?? p.en : p.en ?? p.hi) : null);
  const location = [client.city, client.state].filter(Boolean).join(', ');

  const details = [
    { label: t.home.phone, value: <span className="tabular-nums">{formatDisplayPhone(client.phone)}</span> },
    { label: t.home.gender, value: genderLabel(t, client.gender) },
    { label: t.home.age, value: `${client.age} ${t.home.years}` },
    { label: t.home.relationship, value: relationshipLabel(t, client.marital_status) },
    { label: t.home.location, value: location || '—' },
  ];

  const statusLabel: Record<AttemptSummary['status'], string> = {
    paid: t.assess.statusReady,
    in_progress: t.assess.statusInProgress,
    completed: t.assess.statusCompleted,
    stopped: t.assess.statusStopped,
  };

  return (
    <div lang={lang} className="flex min-h-screen flex-col bg-cream">
      <ClientHeader currentLang={lang} onLanguageChange={setLang} showSignOut />

      <main className="mx-auto w-full max-w-[960px] flex-1 px-4 pb-[max(32px,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:py-12">
        {/* Greeting */}
        <div className="mb-6 sm:mb-8">
          <Pill>
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
            <span>{t.home.statusVerified}</span>
          </Pill>
          <h1 className="mt-4 break-words text-[30px] font-semibold leading-[1.2] text-teal sm:text-[40px]">
            {t.home.welcome} {client.full_name}
          </h1>
        </div>

        <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4 sm:space-y-6">
            {/* Start an assessment */}
            <section>
              <h2 className="mb-3 text-[22px] font-semibold leading-[1.3] text-teal">{t.assess.startTitle}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {tests.map((test) => (
                  <Card key={test.code} className="flex flex-col p-5">
                    <h3 className="text-[19px] font-semibold leading-[1.3] text-ink">{local(test.name)}</h3>
                    <p lang="en" className="mt-1 text-[13px] text-ink-muted">
                      {t.brand.endorsement}
                    </p>
                    {test.subtitle && <p className="mt-3 flex-1 text-[15px] leading-[23px] text-ink-soft">{local(test.subtitle)}</p>}
                    <ButtonLink href={`/payment/${test.code}`} variant="secondary" className="mt-4 self-start">
                      {t.assess.start}
                    </ButtonLink>
                  </Card>
                ))}
              </div>
            </section>

            {/* Your assessments */}
            <Card className="p-6 sm:p-8">
              <h2 className="flex items-center gap-2 text-[20px] font-semibold leading-[1.3] text-teal">
                <ClipboardList size={20} strokeWidth={2} aria-hidden />
                <span>{t.assess.yourAssessments}</span>
              </h2>
              {attempts.length === 0 ? (
                <p className="mt-3 text-[15px] text-ink-muted">{t.assess.none}</p>
              ) : (
                <ul className="mt-3 divide-y divide-sand">
                  {attempts.map((a) => {
                    const href = a.status === 'completed' ? `/report/${a.id}` : `/assessment/${a.id}`;
                    const action = a.status === 'completed' ? t.assess.viewReport : a.status === 'stopped' ? null : t.assess.continue;
                    return (
                      <li key={a.id}>
                        <Link href={href} className="flex min-h-[64px] items-center gap-3 py-3 transition-colors hover:bg-mist/50">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-ink">{local(a.name)}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                              <Pill tone={a.status === 'completed' ? 'mist' : 'quiet'}>{statusLabel[a.status]}</Pill>
                              {a.reportId && <span className="font-mono">{a.reportId}</span>}
                            </p>
                          </div>
                          {action && (
                            <span className="flex shrink-0 items-center gap-1 text-[14px] font-semibold text-teal">
                              {action}
                              <ChevronRight size={16} strokeWidth={2} aria-hidden />
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-4 flex items-start gap-2 rounded-input bg-mist px-4 py-3 text-[14px] leading-[22px] text-ink-soft">
                <Lock size={16} strokeWidth={2} className="mt-[3px] shrink-0 text-teal" aria-hidden />
                <span>{t.home.counsellingAssurance}</span>
              </p>
            </Card>
          </div>

          {/* Your details */}
          <Card className="p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-[20px] font-semibold leading-[1.3] text-teal">
              <User size={20} strokeWidth={2} aria-hidden />
              <span>{t.home.profileTitle}</span>
            </h2>
            <p className="mt-1 text-[14px] text-ink-muted">{t.home.detailsNote}</p>

            <dl className="mt-4 divide-y divide-sand">
              {details.map(({ label, value }) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3 last:pb-0">
                  <dt className="text-[14px] text-ink-muted">{label}</dt>
                  <dd className="text-right text-[16px] font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </main>

      <Footer className="standalone:hidden" />
    </div>
  );
}
