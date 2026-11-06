// The counsellor's conclusion: rules shared by the editor (browser) and the server. No server code here.

export const CONCLUSION_MAX_LENGTH = 20_000;

export interface Conclusion {
  body: string;
  created_at: string;
  updated_at: string;
  /** The editor's name as it was when they saved (counsellors cannot read other staff profiles). */
  updated_by_name: string;
}

/** Plain line endings, no spaces at line ends, at most one empty line between paragraphs. */
export function cleanConclusion(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Write the conclusion first.' };
  const body = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) return { ok: false, error: 'Write the conclusion first.' };
  if (body.length > CONCLUSION_MAX_LENGTH) {
    return { ok: false, error: `The conclusion is too long: ${body.length.toLocaleString('en-IN')} characters, at most 20,000.` };
  }
  return { ok: true, body };
}

/** Paragraphs as written: split at empty lines; single line breaks stay inside a paragraph. */
export function conclusionParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).filter((p) => p.trim() !== '');
}

/** Lines of a paragraph when every line is a "• " / "- " bullet, else null (the PDF prints these as a list). */
export function bulletLines(paragraph: string): string[] | null {
  const lines = paragraph.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !lines.every((l) => /^[•\-*]\s+/.test(l))) return null;
  return lines.map((l) => l.replace(/^[•\-*]\s+/, ''));
}
