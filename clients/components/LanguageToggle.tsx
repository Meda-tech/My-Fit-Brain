'use client';

import { SupportedLanguage } from '../lib/types';

interface LanguageToggleProps {
  currentLang: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
}

const optionClasses = (selected: boolean) =>
  `min-w-12 h-full px-3 text-[14px] font-medium rounded-full transition-colors ${
    selected ? 'bg-mist text-teal font-semibold' : 'text-ink-soft hover:text-teal'
  }`;

export function LanguageToggle({ currentLang, onLanguageChange }: LanguageToggleProps) {
  return (
    <div
      role="group"
      aria-label="Language selection"
      className="inline-flex h-11 items-center border border-sand rounded-full bg-white p-1"
    >
      <button
        type="button"
        aria-pressed={currentLang === 'en'}
        onClick={() => onLanguageChange('en')}
        lang="en"
        className={optionClasses(currentLang === 'en')}
      >
        EN
      </button>

      <button
        type="button"
        aria-pressed={currentLang === 'hi'}
        onClick={() => onLanguageChange('hi')}
        lang="hi"
        className={optionClasses(currentLang === 'hi')}
      >
        हिं
      </button>
    </div>
  );
}
