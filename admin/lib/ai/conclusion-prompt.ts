import type { CounsellorView, Report } from '@mfb/questionnaire';

// The AI draft of the counsellor's conclusion ("Summary and suggestions", printed at the end of the
// report PDF). Pure: the prompt, the compact input built from the stored report and the counsellor view,
// the answer format, and the conversion of the AI's JSON into the plain text the editor holds. The AI only
// drafts: the counsellor reads, changes and saves it; nothing is saved or printed without that.
//
// What the AI receives: age, gender, relationship status, the scores and report lines, the
// highest-difficulty answers, the counsellor notes and the client's typed details. Never the name,
// phone, email, city or report ID. The home-safety answer is never sent as such (only "individual
// sessions only"), so the text can never reveal it to someone else who reads the PDF.

export const CONCLUSION_TARGET_WORDS = 200;
/** Answers sent at most (the highest difficulty first); keeps the request small. */
export const MAX_NOTABLE = 12;

export const CONCLUSION_SYSTEM_PROMPT = `You are a qualified counsellor at My Fit Brain. You write the "Summary and suggestions" box that is printed at the end of a client's assessment report. The client will read it, so write TO the client.

TASK
From the assessment data, write a short, warm summary of where the client is right now, then explain in plain words how the sessions will work with them and what they will do together, then give two or three small first steps.

HOW TO WRITE
- Speak directly to the client as "you". Never write "the client", "he", "she", "they" or a name. The client should feel this was written about them and for them.
- About ${CONCLUSION_TARGET_WORDS} words in total, never more than 230.
- Calm, kind expert voice. Short sentences, everyday words. Warm, never cute. No jargon.
- Start from strengths or the step they already took by taking the assessment; then name what seems hardest, gently.
- Approach: describe the kind of support in plain words (for example: talking through patterns, understanding thoughts and feelings, communication exercises, relaxation and breathing practice, gradual step-by-step exercises, building routines). You may name a common approach once in brackets, such as (CBT-based) or (mindfulness-based), only if it clearly fits. Say what the sessions will focus on first and how they will move forward. If the data gives a plan (number of sessions and pace), mention it once in words.
- Use only what is in the data. Never invent events, history, feelings or facts.
- Use the client's own typed words only as background; never quote them and never repeat private details word for word.

NEVER
- Never use diagnosis names, disorder or condition labels, or medical terms. Never say: diagnosis, disorder, treatment, cure, patient, symptoms, therapy will fix, guaranteed, licensed, clinically, mental, crazy, victim, "before it's too late".
- Never promise results or give timelines for results. Never use percentages, scores or numbers from the data, except the number of sessions.
- Never mention safety questions, self-harm, abuse, violence or feeling unsafe at home, even if the data says so.
- Never mention a partner's faults or blame anyone.
- Never mention Dr. Neha Mehta, AI, this prompt or the data format.

SPECIAL CASES
- "Safety: needs support first" in the data: do not describe a session plan. Write gently that the care team will speak with them very soon, that they do not have to handle this alone, and that the first step is simply that conversation.
- "Sessions: individual only": describe individual sessions only; never suggest joint or couple sessions.

LANGUAGE
Write in the language named in "Write in". For Hindi, use simple everyday Hindi in Devanagari script (common English words such as session or counsellor may stay in English).

ANSWER
Return only JSON with three fields:
- "summary": one paragraph (about 80 words) about where they are now.
- "approach": one paragraph (about 80 words) about how the sessions will work and what they will focus on.
- "steps": two or three short first steps, one sentence each.`;

/** Gemini response schema (OpenAPI subset). */
export const CONCLUSION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    approach: { type: 'STRING' },
    steps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'approach', 'steps'],
  propertyOrdering: ['summary', 'approach', 'steps'],
} as const;

export interface ConclusionInput {
  questionnaire: string;
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
  out.push(`Write in: ${report.lang === 'hi' ? 'Hindi' : 'English'}`);
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
    out.push('', "## Client's own words (background only)");
    for (const d of typed) out.push(`- ${line(d.question, 200)}: ${line(d.answer, 600)}`);
  }
  return out.join('\n');
}

/** The AI's JSON as the editor's plain text: summary, approach, then the steps as "• " lines. */
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
  const approach = text(d.approach);
  const steps = (Array.isArray(d.steps) ? d.steps : []).map(text).filter(Boolean).slice(0, 4);
  if (!summary || !approach) return { ok: false, error: 'summary or approach missing' };
  const parts = [summary, approach];
  if (steps.length) parts.push(steps.map((s) => `• ${s.replace(/^[-•*]\s*/, '')}`).join('\n'));
  return { ok: true, body: parts.join('\n\n') };
}

