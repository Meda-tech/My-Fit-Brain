import type { Language } from './i18n';

export const LANG_COOKIE = 'mfb_lang';

export function parseLang(value: string | undefined): Language {
  return value === 'hi' ? 'hi' : 'en';
}
