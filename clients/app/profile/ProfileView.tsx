'use client';

import { Languages, Lock, LogOut } from 'lucide-react';
import { ClientRecord } from '../../lib/types';
import { isGender, isRelationshipStatus } from '../../lib/options';
import { translations } from '../../lib/i18n';
import { formatDisplayPhone } from '../../lib/phone';
import { useLanguage } from '../../components/LanguageProvider';
import { LanguageToggle } from '../../components/LanguageToggle';
import { PageChrome } from '../../components/PageChrome';
import { Button, Card, Footer } from '../../components/brand';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function ProfileView({ client }: { client: ClientRecord }) {
  const { lang, setLang } = useLanguage();
  const t = translations[lang];
  const location = [client.city, client.state].filter(Boolean).join(', ');

  // Stored values are English keys; show them in the chosen language.
  const details = [
    { label: t.home.gender, value: isGender(client.gender) ? t.options.gender[client.gender] : client.gender },
    { label: t.home.age, value: `${client.age} ${t.home.years}` },
    {
      label: t.home.relationship,
      value: isRelationshipStatus(client.marital_status) ? t.options.relationship[client.marital_status] : client.marital_status,
    },
    { label: t.home.location, value: location || '—' },
    { label: t.profile.email, value: client.email || '—' },
  ];

  return (
    <PageChrome>
      <h1 className="sr-only">{t.profile.title}</h1>

      {/* Identity */}
      <div className="mb-6 flex items-center gap-4">
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-mist font-heading text-[22px] font-semibold text-teal"
        >
          {initials(client.full_name)}
        </div>
        <div className="min-w-0">
          <p className="wrap-break-word text-[22px] font-semibold leading-tight text-ink">{client.full_name}</p>
          <p className="mt-1 text-[15px] tabular-nums text-ink-muted">{formatDisplayPhone(client.phone)}</p>
        </div>
      </div>

      {/* Details */}
      <Card className="p-5">
        <h2 className="text-[18px] font-semibold text-teal">{t.home.profileTitle}</h2>
        <p className="mt-1 text-[14px] text-ink-muted">{t.home.detailsNote}</p>
        <dl className="mt-3 divide-y divide-sand">
          {details.map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-3 last:pb-0">
              <dt className="text-[14px] text-ink-muted">{label}</dt>
              <dd className="min-w-0 wrap-break-word text-right text-[16px] font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Language */}
      <Card className="mt-4 flex items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <Languages size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
          <div>
            <h2 className="text-[16px] font-semibold text-ink">{t.profile.language}</h2>
            <p className="mt-0.5 text-[14px] text-ink-muted">{t.profile.languageNote}</p>
          </div>
        </div>
        <LanguageToggle currentLang={lang} onLanguageChange={setLang} />
      </Card>

      <p className="mt-4 flex items-start gap-2 rounded-input bg-mist px-4 py-3 text-[14px] leading-5.5 text-ink-soft">
        <Lock size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        <span>{t.profile.privacy}</span>
      </p>

      <form action="/api/auth/signout" method="POST" className="mt-6">
        <Button type="submit" variant="secondary" fullWidth>
          <LogOut size={18} strokeWidth={2} aria-hidden />
          {t.common.signOut}
        </Button>
      </form>

      <Footer bordered={false} className="mt-6" />
    </PageChrome>
  );
}
