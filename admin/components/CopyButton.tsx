'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './brand';

/** Copies a text to the clipboard (the AI prompt, a version's JSON, a pay link). */
export function CopyButton({ text, label, variant = 'secondary' }: { text: string; label: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this text:', text);
    }
  };
  return (
    <Button type="button" variant={variant} onClick={copy}>
      {copied ? <Check size={18} strokeWidth={2} aria-hidden /> : <Copy size={18} strokeWidth={2} aria-hidden />}
      <span>{copied ? 'Copied' : label}</span>
    </Button>
  );
}
