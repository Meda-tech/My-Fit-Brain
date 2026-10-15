'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { Language } from '../lib/i18n';
import { LANG_COOKIE } from '../lib/lang-cookie';

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// One language choice for the whole app, remembered in a cookie so every screen
// (and the server's first render) uses it.
export function LanguageProvider({
  initialLang,
  children,
}: {
  initialLang: Language;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Language>(initialLang);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
