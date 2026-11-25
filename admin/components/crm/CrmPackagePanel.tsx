import { Check, Phone } from 'lucide-react';
import { SidePanel } from '../purchases/SidePanel';
import { PackagePaymentDialog } from '../packages/PackagePaymentDialog';
import { formatAmount, formatDate, formatDateTime, paymentMethodLabel } from '../payments/format';
import { cn } from '../brand';
import { milestoneLabel, type PackagePayment } from '../../lib/package';
import type { CrmPackageRow } from '../../lib/services/crm';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-[14px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 text-right text-ink">{children}</dd>
    </div>
  );
}

// One package in a right-side panel (CRM page): the client's name and phone, package · paid so far · remaining, the
// next milestone and the milestone list, and the package payments with their proof links. "Add package payment" while
// something remains. Nothing from the assessment is shown here, and there are no session features yet.
export function CrmPackagePanel({
  pkg,
  payments,
  closeHref,
  showCrm,
}: {
  pkg: CrmPackageRow;
  payments: PackagePayment[];
  closeHref: string;
  /** Super admins: who the CRM person is. */
  showCrm: boolean;
}) {
  const clientLabel = pkg.client_name ?? pkg.phone;
  const next = pkg.remaining_paise > 0 && pkg.next_paid_paise !== null ? { session: pkg.next_session, paid_paise: pkg.next_paid_paise } : null;
  return (
    <SidePanel title={pkg.client_name ?? 'Not registered yet'} closeHref={closeHref}>
      <div className="mb-5 grid gap-1">
        <a href={`tel:${pkg.phone}`} className="inline-flex min-h-11 w-fit items-center gap-2 font-mono text-[16px] font-semibold text-teal hover:underline">
          <Phone size={16} strokeWidth={2} aria-hidden />
          {pkg.phone}
        </a>
        <p className="m-0 text-[15px] text-ink">
          Package{pkg.package_name ? `: ${pkg.package_name}` : ''}
          {pkg.sessions ? `, ${pkg.sessions} sessions` : ''}
          {pkg.frequency ? ` · ${pkg.frequency}` : ''}
        </p>
        <p className="m-0 text-[14px] text-ink-soft">Started {formatDate(pkg.started_at)}</p>
        {showCrm && (
          <p className="m-0 text-[14px] text-ink-soft">
            CRM: <span className="font-medium text-ink">{pkg.crm_name ?? 'Not assigned yet'}</span>
          </p>
        )}
      </div>

      <dl className="m-0 mb-2 grid grid-cols-3 gap-2 rounded-card border border-sand bg-cream p-3 text-center">
        <div>
          <dt className="text-[12px] text-ink-muted">Package</dt>
          <dd className="m-0 text-[16px] font-semibold text-ink">{formatAmount(pkg.total_paise)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Paid so far</dt>
          <dd className="m-0 text-[16px] font-semibold text-teal">{formatAmount(pkg.paid_paise)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Remaining</dt>
          <dd className="m-0 text-[16px] font-semibold text-ink">{formatAmount(pkg.remaining_paise)}</dd>
        </div>
      </dl>
      <p className="m-0 mb-4 text-[14px] font-medium text-teal">Next milestone: {milestoneLabel(next)}</p>
      {pkg.remaining_paise > 0 && (
        <div className="mb-6">
          <PackagePaymentDialog purchaseId={pkg.parent_purchase_id} clientLabel={clientLabel} variant="primary" />
        </div>
      )}

      {pkg.milestones.length > 0 && (
        <section aria-labelledby="crm-milestones" className="mb-6">
          <h3 id="crm-milestones" className="mb-2 text-[16px] font-semibold text-teal">
            Milestones
          </h3>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {pkg.milestones.map((m) => {
              const met = pkg.paid_paise >= m.paid_paise;
              return (
                <li key={`${m.session}-${m.paid_paise}`} className="flex items-center gap-2.5 text-[14px]">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      met ? 'bg-teal text-white' : 'border-2 border-sand bg-white'
                    )}
                  >
                    {met && <Check size={13} strokeWidth={3} aria-hidden />}
                  </span>
                  <span className={met ? 'text-ink' : 'text-ink-soft'}>
                    {formatAmount(m.paid_paise)} before session {m.session}
                    <span className="text-ink-muted"> · {met ? 'met' : `${formatAmount(m.paid_paise - pkg.paid_paise)} more`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="crm-payments">
        <h3 id="crm-payments" className="mb-2 text-[16px] font-semibold text-teal">
          Package payments ({payments.length})
        </h3>
        {payments.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-muted">No payments to show.</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {payments.map((p) => {
              const manual = p.provider === 'offline';
              return (
                <li key={p.id} className="rounded-card border border-sand p-4">
                  <p className="mb-2 font-semibold text-ink">
                    {formatAmount(p.amount_paise)} · {manual ? 'manual payment' : 'in the app'}
                    {p.refund_needed && <span className="ml-2 text-[13px] font-semibold text-coral-deep">Refund needed · not counted</span>}
                  </p>
                  <dl className="grid gap-1.5">
                    <Row label="Paid">{formatDateTime(p.paid_at)}</Row>
                    <Row label="Method">{paymentMethodLabel(p)}</Row>
                    {manual && (
                      <>
                        <Row label="Reference">
                          <span className="font-mono text-[12px]">{p.reference ?? '—'}</span>
                        </Row>
                        <Row label="Recorded by">{p.recorded_by_name ?? '—'}</Row>
                        <Row label="Accounts check">{p.accounts_check === 'checked' ? 'Checked' : 'Pending'}</Row>
                        {p.proof_url && (
                          <Row label="Proof">
                            <a href={p.proof_url} target="_blank" rel="noreferrer" className="font-medium text-teal hover:underline">
                              Open
                            </a>
                          </Row>
                        )}
                      </>
                    )}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SidePanel>
  );
}
