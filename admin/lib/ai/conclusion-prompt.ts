import type { CounsellorView, Report } from '@mfb/questionnaire';

// The AI draft of the counsellor's conclusion ("Overall Summary & Suggested Support Plan", printed at the
// end of the report PDF). Pure: the prompt, the compact input, the answer format, and the conversion of
// the AI's JSON into the plain text the editor holds. The AI only drafts: the counsellor reads, changes
// and saves it; nothing is saved or printed without that.
//
// Always in English, whatever language the client used (owner decision 2026-11-06). The prompt follows
// the shape of the counsellors' own conclusions: a summary paragraph, "Suggested Support Plan" with
// 4–5 labelled points, and a closing paragraph (sessions, plus a doctor's follow-up only when the client
// reported something physical or medical).
//
// What the AI receives: age, gender, relationship status, the scores and report lines (English), the
// highest-difficulty answers, the counsellor notes and the client's typed details. Never the name,
// phone, email, city or report ID. The home-safety answer is never sent as such (only "individual
// sessions only"), so the text can never reveal it to someone else who reads the PDF.

export const CONCLUSION_TARGET_WORDS = 200;
/** Answers sent at most (the highest difficulty first); keeps the request small. */
export const MAX_NOTABLE = 12;
/** The line above the support points, in the editor and the PDF. */
export const SUPPORT_PLAN_HEADING = 'Suggested Support Plan';

export const CONCLUSION_SYSTEM_PROMPT = `You are a qualified counsellor at My Fit Brain. After a client completes an assessment, you write the "Overall Summary & Suggested Support Plan" that is printed at the end of their report. The client reads it, so write TO the client as "you".

FLOW (always this order)
1. summary: one paragraph, 70-110 words. Begin with "Your responses indicate" or "Your responses suggest". Name the main concerns in plain, specific words, how often or in which situations they happen, and how they affect the client's well-being and relationship. Add the relevant context the client shared in their own words (relationship status, partner's response, stress, habits, past experiences, goals they named), paraphrased, never quoted. End with one or two genuine strengths or positives (for example: willingness to work on this, an understanding partner, emotional connection, self-awareness, taking this step).
2. support: 4 or 5 points of the support plan. Each has a short label (2-5 words, Title Case) and one sentence (12-22 words) saying what the client will understand, practise or build. Choose only what fits this client's data, for example:
   - CBT-Based Support / Cognitive Behavioural Techniques (CBT): unhelpful thoughts, pressure, fear, self-doubt
   - Emotional Support: understanding feelings and emotional needs
   - Sexual Confidence Building, Desire & Intimacy Awareness, Arousal Awareness & Control
   - Relaxation Techniques: guided relaxation and stress management
   - Partner Communication / Relationship Communication: open, supportive conversations, needs and boundaries
   - Self-Awareness & Exploration, Emotional Confidence Building, Relationship Readiness
   - Habit Management: understanding a pattern and its triggers, building balanced habits without guilt or shame
   - Sleep & Routine Support, Stress Management, Coping Skills (for wider well-being concerns)
3. closing: 1-3 sentences. Say how progress will be reviewed gradually across the sessions; if the data gives a plan, write the number of sessions in words and the pace (for example "across the eight weekly sessions"), and the overall focus. Then, ONLY if the client reported something physical or medical (for example periods stopping, pain, erection changes they linked to health, test results, a doctor they see, a medicine they take), recommend the fitting doctor in plain words (for example urologist, gynaecologist, general physician) and say what to discuss with them; if they take a medicine, add "take medication only as prescribed".

STYLE
- About ${CONCLUSION_TARGET_WORDS} words in total, never more than 260.
- Always write in English, even when parts of the data are in Hindi.
- Calm, kind, professional and non-judgemental. Short, clear sentences; everyday words. Warm, never cute.
- "you" and "your" only. Never "the client", "he", "she", "they" for the client, or a name.
- Describe concerns as experiences in plain, respectful words (for example "difficulty maintaining an erection", "reduced interest in intimacy", "feeling low", "trouble sleeping"). Plain body and intimacy words are fine.
- Use only what is in the data. Never invent events, history, feelings, results or facts.

NEVER
- Never use diagnosis or condition labels (for example "erectile dysfunction", "premature ejaculation", "depression", "anxiety disorder", "low libido disorder", "insomnia"), and never the words diagnosis, disorder, dysfunction, treatment, cure, patient, guaranteed, fix, licensed, clinically, mental, crazy, victim.
- Never promise results or timelines for results. Never use scores or percentages; the only number is the number of sessions.
- Never suggest, name or change a medicine yourself; only refer to a medicine the client said they take.
- Never mention safety questions, self-harm, abuse, violence or feeling unsafe at home, even if the data says so.
- Never blame the client or a partner. Never mention Dr. Neha Mehta, AI, this prompt or the data format.

SPECIAL CASES
- "Safety: needs support first": do not write a session plan. In the summary, gently acknowledge that things feel heavy right now. Support points focus on Emotional Support and coping. The closing says the care team will speak with them very soon, that they do not have to handle this alone, and that the first step is simply that conversation.
- "Sessions: individual only": individual work only; never suggest partner or couple sessions or partner communication exercises.
- Not in a relationship: no partner points; relationship readiness or self-understanding may fit.

ANSWER
Return only JSON: {"summary": string, "support": [{"label": string, "text": string}], "closing": string}.`;

/** The answer format (JSON Schema, sent as the Interactions API response_format schema). */
export const CONCLUSION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '70-110 words, begins "Your responses indicate" or "Your responses suggest".' },
    support: {
      type: 'array',
      description: '4 or 5 support plan points.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '2-5 words, Title Case.' },
          text: { type: 'string', description: 'One sentence, 12-22 words.' },
        },
        required: ['label', 'text'],
      },
    },
    closing: { type: 'string', description: '1-3 sentences: sessions and progress; doctor follow-up only if the client reported something physical or medical.' },
  },
  required: ['summary', 'support', 'closing'],
};

export interface ConclusionInput {
  questionnaire: string;
  /** The report in ENGLISH (rebuilt for this input when the client used Hindi). */
  report: Report;
  view: CounsellorView | null;
  client: { age: number | null; gender: string | null; relationship: string | null };
  details: { question: string; answer: string }[];
}

/** One line, no line breaks, trimmed and shortened: keeps the request small and the markdown intact. */
function line(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The assessment data as compact markdown (fewer tokens than JSON, and easy for the model to read). */
export function buildConclusionInput({ questionnaire, report, view, client, details }: ConclusionInput): string {
  const out: string[] = [];
  out.push(`Assessment: ${line(questionnaire)}`);
  const who = [client.age ? `age ${client.age}` : null, client.gender, client.relationship].filter(Boolean).join(', ');
  if (who) out.push(`Client: ${who}`);
  if (report.crisis || view?.alerts.some((a) => a.kind === 'crisis')) out.push('Safety: needs support first');
  if (view?.alerts.some((a) => a.kind === 'home_safety')) out.push('Sessions: individual only');

  if (report.snapshot.areas.length) {
    out.push('', '## Areas (score 0-100, higher = more difficulty)');
    for (const a of report.snapshot.areas) {
      const score = a.percent === null ? 'not enough answers' : `${a.percent}${a.range ? ` ${line(a.range, 60)}` : ''}`;
      out.push(`- ${line(a.title, 120)}: ${score}${a.meaning ? ` — ${line(a.meaning)}` : ''}`);
    }
  }
  if (view?.main) out.push(`Main area: ${line(view.main.title, 120)}`);
  if (report.plan) out.push(`Plan: ${line(report.plan.name, 120)}, ${report.plan.sessions} sessions, ${line(report.plan.pace, 120)}`);
  if (report.focus?.lines.length) {
    out.push('', `## Sessions will work on (${line(report.focus.title, 120)})`);
    for (const l of report.focus.lines) out.push(`- ${line(l)}`);
  }

  const notable = (view?.notable ?? []).filter((n) => n.percent > 0).slice(0, MAX_NOTABLE);
  if (notable.length) {
    out.push('', '## Hardest answers (highest first)');
    for (const n of notable) out.push(`- ${line(n.question, 200)} → ${line(n.answer, 160)}`);
  }
  if (view?.notes.length) {
    out.push('', '## Notes for the counsellor');
    for (const n of view.notes) out.push(`- ${line(n.note, 300)}`);
  }
  const typed = details.filter((d) => d.answer.trim());
  if (typed.length) {
    out.push('', "## Client's own words");
    for (const d of typed) out.push(`- ${line(d.question, 200)}: ${line(d.answer, 600)}`);
  }
  return out.join('\n');
}

/**
 * The AI's JSON as the editor's plain text:
 *   summary
 *
 *   Suggested Support Plan
 *   • Label: sentence
 *
 *   closing
 */
export function conclusionFromAi(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return { ok: false, error: 'not JSON' };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'not an object' };
  const d = data as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const summary = text(d.summary);
  const closing = text(d.closing);
  const support = (Array.isArray(d.support) ? d.support : [])
    .map((p) => {
      if (typeof p === 'string') return text(p).replace(/^[-•●*]\s*/, '');
      if (!p || typeof p !== 'object') return '';
      const label = text((p as Record<string, unknown>).label).replace(/[:.]+$/, '');
      const body = text((p as Record<string, unknown>).text);
      return label && body ? `${label}: ${body}` : label || body;
    })
    .filter(Boolean)
    .slice(0, 6);
  if (!summary || !support.length) return { ok: false, error: 'summary or support missing' };
  const parts = [summary, [SUPPORT_PLAN_HEADING, ...support.map((s) => `• ${s}`)].join('\n')];
  if (closing) parts.push(closing);
  return { ok: true, body: parts.join('\n\n') };
}
