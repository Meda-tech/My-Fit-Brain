'use client';

import { CheckCircle2, User, Hourglass, Lock } from 'lucide-react';
import { ClientRecord } from '../lib/types';
import { isGender, isRelationshipStatus } from '../lib/options';
import { translations } from '../lib/i18n';
import { useLanguage } from '../components/LanguageProvider';
import { ClientHeader } from '../components/ClientHeader';
import { formatDisplayPhone } from '../lib/phone';
import { Card, Footer, Pill } from '../components/brand';

interface ClientHomeViewProps {
  client: ClientRecord;
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

export function ClientHomeView({ client }: ClientHomeViewProps) {
  const { lang, setLang } = useLanguage();
  const t = translations[lang];
  const location = [client.city, client.state].filter(Boolean).join(', ');

  const details = [
    { label: t.home.phone, value: <span className="tabular-nums">{formatDisplayPhone(client.phone)}</span> },
    { label: t.home.gender, value: genderLabel(t, client.gender) },
    { label: t.home.age, value: `${client.age} ${t.home.years}` },
    { label: t.home.relationship, value: relationshipLabel(t, client.marital_status) },
    { label: t.home.location, value: location || '—' },
  ];

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
          <p className="mt-2 max-w-[560px] text-[17px] leading-[26px] text-ink-soft">
            {t.home.phase1Notice}
          </p>
        </div>

        <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* What happens next */}
          <Card className="p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-mist text-teal">
                <Hourglass size={24} strokeWidth={2} aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 className="text-[22px] font-semibold leading-[1.3] text-teal sm:text-[24px]">
                  {t.home.nextPhaseTitle}
                </h2>
                <p className="mt-2 text-[16px] leading-[26px] text-ink-soft">{t.home.nextPhaseNote}</p>
              </div>
            </div>

            <p className="mt-6 flex items-start gap-2 rounded-input bg-mist px-4 py-3 text-[14px] leading-[22px] text-ink-soft">
              <Lock size={16} strokeWidth={2} className="mt-[3px] shrink-0 text-teal" aria-hidden />
              <span>{t.home.counsellingAssurance}</span>
            </p>
          </Card>

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
