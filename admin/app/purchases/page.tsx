import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, cn } from '../../components/brand';
import { PurchasePanel } from '../../components/purchases/PurchasePanel';
import { PurchaseStatusPill } from '../../components/purchases/PurchasePills';
import { formatAmount, formatDate, formatTime } from '../../components/payments/format';
import { JOURNEY_STAGE_LABELS } from '../../lib/purchases';
import { PURCHASE_PAGE_SIZE, canViewPurchases, getPurchase, listPurchases, type PurchaseRow } from '../../lib/services/purchases';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stageText(r: PurchaseRow): string {
  if (r.status !== 'paid') return '—';
  return r.current_stage ? JOURNEY_STAGE_LABELS[r.current_stage] : 'All done';
}

// Purchases: every pay-page try and manual payment, newest first. Super admins see all; a coordinator sees
// the purchases of their own clients (RLS). A row opens the purchase journey in a right-side panel.
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ page?: string; open?: string }> }) {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) redirect('/dashboard');
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const [{ rows, total }, open] = await Promise.all([
    listPurchases(page),
    sp.open && UUID.test(sp.open) ? getPurchase(sp.open) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PURCHASE_PAGE_SIZE));
  const listHref = (p: number) => (p > 1 ? `/purchases?page=${p}` : '/purchases');
  const openHref = (id: string) => `/purchases?${new URLSearchParams({ ...(page > 1 ? { page: String(page) } : {}), open: id })}`;
  const coordinator = profile.role === 'coordinator';

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Purchases"
        description={
          coordinator
            ? 'Purchases of your clients. Open one to see its purchase journey.'
            : 'Every purchase: pay-page tries and manual payments. Open one to see its purchase journey.'
        }
      />

      <Card className="overflow-hidden">
        <div className="border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {total} {total === 1 ? 'purchase' : 'purchases'}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <ShoppingBag size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No purchases yet.</p>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-sand md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={openHref(r.id)} scroll={false} className="block p-4 hover:bg-cream">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{r.client_name ?? r.phone}</p>
                        {r.client_name && <p className="font-mono text-[12px] text-ink-muted">{r.phone}</p>}
                      </div>
                      <PurchaseStatusPill status={r.status} />
                    </div>
                    <p className="mt-2 text-[13px] text-ink-soft">
                      {r.test_code} · {formatAmount(r.amount_paise)} · {formatDate(r.created_at)} · Now: {stageText(r)}
                    </p>
                    <p className="text-[13px] text-ink-muted">Coordinator: {r.coordinator_name ?? 'None yet'}</p>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Wider screens: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold">Assessment</th>
                    <th className="px-5 py-3 font-semibold">Amount</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Stage now</th>
                    <th className="px-5 py-3 font-semibold">Coordinator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {rows.map((r) => (
                    <tr key={r.id} className={cn('relative hover:bg-cream', open?.id === r.id && 'bg-mist')}>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {/* The link covers the whole row. */}
                        <Link href={openHref(r.id)} scroll={false} className="after:absolute after:inset-0" aria-label={`Open purchase of ${r.client_name ?? r.phone}`}>
                          {formatDate(r.created_at)}
                        </Link>
                        <span className="block text-[12px] text-ink-muted">{formatTime(r.created_at)}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-medium text-ink">{r.client_name ?? 'Not registered yet'}</span>
                        <span className="block font-mono text-[12px] text-ink-muted">{r.phone}</span>
                      </td>
                      <td className="px-5 py-3">{r.test_name}</td>
                      <td className="px-5 py-3 whitespace-nowrap">{formatAmount(r.amount_paise)}</td>
                      <td className="px-5 py-3">
                        <PurchaseStatusPill status={r.status} />
                      </td>
                      <td className="px-5 py-3">{stageText(r)}</td>
                      <td className="px-5 py-3">{r.coordinator_name ?? <span className="text-ink-muted">None yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-sand p-4 text-[14px]">
            {page > 1 ? (
              <Link href={listHref(page - 1)} className="font-medium text-teal hover:underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={listHref(page + 1)} className="font-medium text-teal hover:underline">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>

      {open && <PurchasePanel purchase={open} closeHref={listHref(page)} now={new Date()} />}
    </AdminShell>
  );
}
