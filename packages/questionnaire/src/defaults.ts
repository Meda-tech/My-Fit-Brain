import type { Lang, Range, Section, Text } from './types';

// Everything that is the same for every questionnaire lives here: default ranges and disclaimer,
// the built-in safety section, the support screen, report headings and helplines. EN + HI.

export const ENGINE_VERSION = '1.0.0';

export const DEFAULT_RANGES: Range[] = [
  { up_to: 25, en: 'Low', hi: 'कम' },
  { up_to: 50, en: 'Mild', hi: 'हल्का' },
  { up_to: 75, en: 'Moderate', hi: 'मध्यम' },
  { up_to: 100, en: 'High', hi: 'ज़्यादा' },
];

export const DEFAULT_DISCLAIMER: Text = {
  en: 'This report is based on your own answers and is prepared to guide your consultation with the My Fit Brain team. It is a counselling assessment, not a medical diagnosis, and it does not promise a result. Your counsellor will confirm or adjust the plan with you in your consultation. Your answers are confidential.',
  hi: 'यह रिपोर्ट आपके अपने जवाबों पर आधारित है और माई फ़िट ब्रेन टीम के साथ आपके परामर्श को दिशा देने के लिए बनाई गई है। यह एक काउंसलिंग असेसमेंट है, मेडिकल निदान नहीं, और यह किसी नतीजे का वादा नहीं करती। आपका काउंसलर परामर्श में आपके साथ योजना की पुष्टि या बदलाव करेगा। आपके जवाब गोपनीय हैं।',
};

export const DESIGNED_BY: Text = {
  en: 'Designed by Dr. Neha Mehta, Consultant Psychologist',
  hi: 'डिज़ाइन: डॉ. नेहा मेहता, कंसल्टेंट साइकोलॉजिस्ट',
};

// ---------------------------------------------------------------------------------------------
// Safety (built in, added at the end of every questionnaire; never part of the JSON)

export const SAFETY_SECTION_ID = 'safety';
export const CRISIS_QUESTION_ID = 'safety_crisis';
export const HOME_SAFETY_QUESTION_ID = 'safety_home';
export const YES = 'yes';
export const NO = 'no';

const yesNo = [
  { id: NO, text: { en: 'No', hi: 'नहीं' }, value: null },
  { id: YES, text: { en: 'Yes', hi: 'हाँ' }, value: null },
];

export const SAFETY_SECTION: Section = {
  id: SAFETY_SECTION_ID,
  title: { en: 'Two last questions', hi: 'दो आखिरी सवाल' },
  scored: false,
  show_when: null,
  report: null,
  builtin: true,
  questions: [
    {
      id: CRISIS_QUESTION_ID,
      text: {
        en: 'In the last month, have you had thoughts of hurting yourself, or that life is not worth living?',
        hi: 'पिछले एक महीने में, क्या आपके मन में खुद को नुकसान पहुँचाने के विचार आए, या कि जीना बेकार है?',
      },
      multiple: false,
      max_choices: null,
      show_when: null,
      options: yesNo,
    },
    {
      id: HOME_SAFETY_QUESTION_ID,
      text: {
        en: 'Do you feel unsafe or physically threatened at home?',
        hi: 'क्या आप घर पर असुरक्षित या शारीरिक खतरे में महसूस करते/करती हैं?',
      },
      multiple: false,
      max_choices: null,
      show_when: null,
      options: yesNo,
    },
  ],
};

/** Shown at once when the crisis question is answered yes (the client can then continue). */
export const SUPPORT_SCREEN: Text = {
  en: 'You said you have had thoughts of hurting yourself. Please know you are not alone and support is available right now. If you feel unsafe at any moment, call Tele-MANAS (free, 24x7): 14416 or 1-800-891-4416. A member of our team will call you today.',
  hi: 'आपने बताया कि आपके मन में खुद को नुकसान पहुँचाने के विचार आए। कृपया जानें कि आप अकेले नहीं हैं और सहारा अभी उपलब्ध है। अगर किसी भी पल आप असुरक्षित महसूस करें, तो Tele-MANAS (मुफ्त, 24x7) पर कॉल करें: 14416 या 1-800-891-4416। हमारी टीम का कोई सदस्य आज ही आपको कॉल करेगा।',
};

/** Printed first on a crisis report, in place of the plan. */
export const SUPPORT_REPORT: Text = {
  en: 'Before any plan, we want to talk with you. A member of our team will call you today. Your consultation will focus on you and how you are feeling — nothing else needs to be decided now. If you feel unsafe at any moment, call Tele-MANAS (free, 24x7): 14416 or 1-800-891-4416.',
  hi: 'किसी भी योजना से पहले, हम आपसे बात करना चाहते हैं। हमारी टीम का कोई सदस्य आज ही आपको कॉल करेगा। आपका परामर्श आप पर और आपकी भावनाओं पर केंद्रित होगा — अभी और कुछ तय करने की ज़रूरत नहीं है। अगर किसी भी पल आप असुरक्षित महसूस करें, तो Tele-MANAS (मुफ्त, 24x7) पर कॉल करें: 14416 या 1-800-891-4416।',
};

export const CRISIS_HELPLINES = [
  { display: '14416', tel: '14416' },
  { display: '1-800-891-4416', tel: '18008914416' },
] as const;

/** Home-safety emergency numbers (shown to the counsellor with the alert). */
export const HOME_SAFETY_NUMBERS = ['112 (emergency)', '181 (Women Helpline)'] as const;

// ---------------------------------------------------------------------------------------------
// Report words (UI words only; every other sentence comes from the questionnaire)

export const REPORT_WORDS = {
  snapshot: { en: 'Your snapshot', hi: 'आपकी तस्वीर' },
  plan: { en: 'Your recommended plan', hi: 'आपके लिए सुझाई गई योजना' },
  planNote: { en: 'Your counsellor will confirm the format with you.', hi: 'आपका काउंसलर आपके साथ फ़ॉर्मेट की पुष्टि करेगा।' },
  focus: { en: 'What your sessions will work on', hi: 'आपके सेशन किस पर काम करेंगे' },
  next: { en: 'Your next step', hi: 'आपका अगला कदम' },
  sessions: { en: 'sessions', hi: 'सेशन' },
  notEnough: { en: 'Not enough answers', hi: 'पर्याप्त जवाब नहीं' },
} satisfies Record<string, Text>;

export function pick(text: Text | null | undefined, lang: Lang): string {
  if (!text) return '';
  return (lang === 'hi' ? text.hi || text.en : text.en) ?? '';
}
