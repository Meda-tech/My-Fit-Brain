'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, X } from 'lucide-react';
import { Button, Card, cn } from '../../../components/brand';
import { CopyButton } from '../CopyButton';
import { ImportJsonForm } from '../ImportJsonForm';

// The version row: "New version" on the left (opens the import panel), then one tab per version.
// The paste box stays hidden until it is needed.

export interface VersionTab {
  id: string;
  number: number;
  status: string;
  href: string;
  active: boolean;
}

export function VersionBar({
  code,
  versions,
  canEdit,
  hasDraft,
  prompt,
}: {
  code: string;
  versions: VersionTab[];
  canEdit: boolean;
  hasDraft: boolean;
  prompt: string;
}) {
  const [open, setOpen] = useState(versions.length === 0);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        {canEdit && (
          <Button type="button" size="sm" variant={open ? 'ghost' : 'secondary'} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="shrink-0">
            {open ? <X size={16} strokeWidth={2} aria-hidden /> : <Plus size={16} strokeWidth={2} aria-hidden />}
            <span>{open ? 'Close' : 'New version'}</span>
          </Button>
        )}
        {versions.length > 0 && (
          <nav aria-label="Versions" className="-my-1 flex min-w-0 gap-2 overflow-x-auto py-1">
            {versions.map((x) => (
              <Link
                key={x.id}
                href={x.href}
                aria-current={x.active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[14px] font-medium transition-colors',
                  x.active ? 'border-teal bg-mist font-semibold text-teal' : 'border-sand bg-white text-ink-soft hover:border-teal hover:text-teal'
                )}
              >
                Version {x.number}
                <span className={cn('text-[12px] uppercase tracking-[0.06em]', x.status === 'live' ? 'text-teal' : 'text-ink-muted')}>{x.status}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>

      {canEdit && open && (
        <Card className="mt-4 p-5 sm:p-6">
          <h2 className="text-[20px] font-semibold leading-[1.3] text-teal">{hasDraft ? 'Replace the draft' : 'New version'}</h2>
          <ol className="mt-3 space-y-4">
            <li>
              <p className="text-[15px] text-ink">
                <span className="font-semibold">1.</span> Copy the AI prompt and paste it into any AI together with your questions. To change an
                existing version instead, open it and use <span className="font-semibold">Copy JSON</span>.
              </p>
              <div className="mt-2">
                <CopyButton text={prompt} label="Copy AI prompt" />
              </div>
            </li>
            <li>
              <p className="mb-2 text-[15px] text-ink">
                <span className="font-semibold">2.</span> Paste the JSON the AI gives back.
              </p>
              <ImportJsonForm code={code} hasDraft={hasDraft} />
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
