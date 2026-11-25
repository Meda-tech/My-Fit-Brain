import { redirect } from 'next/navigation';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/brand';
import { PackageSettingsForm } from '../../components/packages/PackageSettingsForm';
import { PackageAmountsForm } from '../../components/packages/PackageAmountsForm';
import { formatDateTime } from '../../components/payments/format';
import { ASSESSMENT_PRICE_PAISE } from '../../lib/offline-payments';
import { getPackage } from '../../lib/services/packages';

export const dynamic = 'force-dynamic';

// Settings (super admins only). For now: the package offered after the report presentation.
export default async function SettingsPage() {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') redirect('/dashboard');
  const settings = await getPackage();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader title="Settings" description="The package offered to a client after their report presentation." />
      <Card className="max-w-180 p-5 sm:p-6">
        <h2 className="m-0 mb-1 text-[20px] font-semibold text-teal">Package</h2>
        {settings ? (
          <>
            <p className="m-0 mb-5 text-[13px] text-ink-muted">Last changed {formatDateTime(settings.updated_at)}. No expiry.</p>
            <PackageSettingsForm settings={settings} assessmentPrice={ASSESSMENT_PRICE_PAISE / 100} />
          </>
        ) : (
          <p className="m-0 text-ink-muted">The package is not set up in the database yet.</p>
        )}
      </Card>
      {settings && (
        <Card className="mt-6 max-w-180 p-5 sm:p-6">
          <h2 className="m-0 mb-1 text-[20px] font-semibold text-teal">Package payments in parts</h2>
          <p className="m-0 mb-5 text-[13px] text-ink-muted">
            The first payment, the amount that starts the package (it then goes to the CRM team), and the milestones.
          </p>
          <PackageAmountsForm settings={settings} assessmentPrice={ASSESSMENT_PRICE_PAISE / 100} />
        </Card>
      )}
    </AdminShell>
  );
}
