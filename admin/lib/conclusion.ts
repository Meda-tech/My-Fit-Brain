// The counsellor's conclusion: rules shared by the editor (browser) and the server. No server code here.

export const CONCLUSION_MAX_LENGTH = 20_000;

/** The PDF heading of the conclusion, always in English (owner decision 2026-11-06). */
export const CONCLUSION_PDF_HEADING = 'Overall Summary & Suggested Support Plan';

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

export type ConclusionBlock =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: { label: string | null; text: string }[] };

const BULLET = /^[•●▪*-]\s+/;

/**
 * The conclusion as blocks for the PDF: paragraphs, bullet lists ("• ", "● ", "- " or "* "; a leading
 * "Label:" is printed bold) and short headings (a line without a full stop right above a list, such as
 * "Suggested Support Plan" or "Your sessions will focus on:").
 */
export function conclusionBlocks(body: string): ConclusionBlock[] {
  const blocks: ConclusionBlock[] = [];
  for (const paragraph of conclusionParagraphs(body)) {
    const lines = paragraph.split('\n').map((l) => l.trim()).filter(Boolean);
    let text: string[] = [];
    const flush = () => {
      if (text.length) blocks.push({ kind: 'text', text: text.join('\n') });
      text = [];
    };
    lines.forEach((l, i) => {
      if (BULLET.test(l)) {
        flush();
        const item = l.replace(BULLET, '');
        const m = item.match(/^([^:.]{2,48}):\s+(.+)$/);
        const entry = m ? { label: m[1].trim(), text: m[2] } : { label: null, text: item };
        const last = blocks[blocks.length - 1];
        if (last?.kind === 'bullets') last.items.push(entry);
        else blocks.push({ kind: 'bullets', items: [entry] });
      } else if (BULLET.test(lines[i + 1] ?? '') && l.length <= 60 && !/[.!?]$/.test(l)) {
        flush();
        blocks.push({ kind: 'heading', text: l.replace(/:$/, '') });
      } else {
        text.push(l);
      }
    });
    flush();
  }
  return blocks;
}
