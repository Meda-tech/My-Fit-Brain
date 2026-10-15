'use client';

import { useState } from 'react';
import { useLanguage } from '../../components/LanguageProvider';
import { ClientAuthLayout } from '../../components/ClientAuthLayout';
import { RegisterForm } from './RegisterForm';
import { AgeStopView } from './AgeStopView';

interface RegisterClientWrapperProps {
  userPhone: string;
}

export function RegisterClientWrapper({ userPhone }: RegisterClientWrapperProps) {
  const { lang, setLang } = useLanguage();
  const [ageStopped, setAgeStopped] = useState(false);

  if (ageStopped) {
    return <AgeStopView lang={lang} onLanguageChange={setLang} />;
  }

  return (
    <ClientAuthLayout lang={lang} onLanguageChange={setLang} showSignOut wide>
      <RegisterForm userPhone={userPhone} lang={lang} onAgeStop={() => setAgeStopped(true)} />
    </ClientAuthLayout>
  );
}
