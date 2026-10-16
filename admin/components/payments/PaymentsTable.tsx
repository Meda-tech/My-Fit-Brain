'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PaymentListRow } from '../../lib/services/payments';
import { PaymentSheet } from './PaymentSheet';
import { PaymentStatusPill } from './PaymentStatusPill';
import { formatAmount, formatDate, formatTime, methodLabel } from './format';

// Payments as table rows (stacked cards on narrow screens). A row opens the side sheet; the open
// payment is kept in the URL (?payment=) so the view can be shared or reloaded.

export function PaymentsTable({ rows, initialSelected }: { rows: PaymentListRow[]; initialSelected: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelected && rows.some((r) => r.id === initialSelected) ? initialSelected : null
  );
  const opener = useRef<HTMLElement | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const setUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('payment', id);
    else url.searchParams.delete('payment');
    window.history.replaceState(null, '', url);
  };

  const open = (id: string, el: HTMLElement) => {
    opener.current = el;
    setSelectedId(id);
    setUrl(id);
  };

  const close = useCallback(() => {
    setSelectedId(null);
    setUrl(null);
    opener.current?.focus();
  }, []);

  const rowProps = (p: PaymentListRow) => ({
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `Payment ${formatAmount(p.amount_paise, p.currency)} from ${p.client?.full_name ?? 'client'}, ${p.status}`,
    onClick: (e: React.MouseEvent<HTMLElement>) => open(p.id, e.currentTarget),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(p.id, e.currentTarget);
      }
    },
  });

  const when = (p: PaymentListRow) => p.paid_at ?? p.created_at;

  return (
    <>
      {/* Narrow screens: stacked rows */}
      <ul className="divide-y divide-sand @3xl:hidden">
        {rows.map((p) => (
          <li
            key={p.id}
            {...rowProps(p)}
            className="flex cursor-pointer items-center gap-3 p-4 outline-none transition-colors hover:bg-mist/50 focus-visible:bg-mist"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-semibold text-ink">{p.client?.full_name ?? '—'}</p>
                <p className="shrink-0 font-heading font-semibold text-ink">{formatAmount(p.amount_paise, p.currency)}</p>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {p.test_name}
                {p.attempt?.report_id ? ` · ${p.attempt.report_id}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                <PaymentStatusPill status={p.status} />
                <span>
                  {formatDate(when(p))}, {formatTime(when(p))}
                </span>
              </div>
            </div>
            <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
          </li>
        ))}
      </ul>

      {/* Wide screens: table */}
      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-sand bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
              <th className="whitespace-nowrap px-5 py-3 font-semibold">Date</th>
              <th className="whitespace-nowrap px-5 py-3 font-semibold">Client</th>
              <th className="whitespace-nowrap px-5 py-3 font-semibold">Assessment</th>
              <th className="whitespace-nowrap px-5 py-3 text-right font-semibold">Amount</th>
              <th className="whitespace-nowrap px-5 py-3 font-semibold">Status</th>
              <th className="hidden whitespace-nowrap px-5 py-3 font-semibold @[60rem]:table-cell">Method</th>
              <th className="hidden whitespace-nowrap px-5 py-3 font-semibold @[70rem]:table-cell">Razorpay ID</th>
              <th className="px-3 py-3">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {rows.map((p) => (
              <tr
                key={p.id}
                {...rowProps(p)}
                data-selected={p.id === selectedId}
                className="cursor-pointer outline-none transition-colors hover:bg-mist/50 focus-visible:bg-mist data-[selected=true]:bg-mist"
              >
                <td className="whitespace-nowrap px-5 py-3.5">
                  <p className="text-ink">{formatDate(when(p))}</p>
                  <p className="text-[12px] text-ink-muted">{formatTime(when(p))}</p>
                </td>
                <td className="px-5 py-3.5">
                  <p className="font-semibold text-ink">{p.client?.full_name ?? '—'}</p>
                  <p className="font-mono text-[12px] text-ink-muted">{p.client?.phone ?? ''}</p>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-ink">{p.test_name}</p>
                  <p className="font-mono text-[12px] text-ink-muted">{p.attempt?.report_id ?? '—'}</p>
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-right font-heading font-semibold text-ink">
                  {formatAmount(p.amount_paise, p.currency)}
                </td>
                <td className="px-5 py-3.5">
                  <PaymentStatusPill status={p.status} />
                </td>
                <td className="hidden whitespace-nowrap px-5 py-3.5 text-ink-soft @[60rem]:table-cell">{methodLabel(p.method)}</td>
                <td className="hidden whitespace-nowrap px-5 py-3.5 font-mono text-[12px] text-ink-muted @[70rem]:table-cell">
                  {p.provider_payment_id ?? p.provider_order_id}
                </td>
                <td className="px-3 py-3.5 text-right">
                  <ChevronRight size={18} strokeWidth={2} className="inline text-teal" aria-hidden />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentSheet payment={selected} onClose={close} />
    </>
  );
}
