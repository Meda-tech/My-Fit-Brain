import { requireClient } from '../lib/auth';
import { homeData } from '../lib/assessment/server';
import { packageHome, recoverPackagePayments } from '../lib/package/server';
import { paymentDeps } from '../lib/payments/server';
import { claimPurchases, recoverOpenPayments } from '../lib/payments/service';
import { ClientHomeView } from './ClientHomeView';

export const dynamic = 'force-dynamic';

export default async function ClientHomePage() {
  const { user, client } = await requireClient();
  const profile = { id: client.id, full_name: client.full_name };
  // Before reading, at the same time: payments made at Razorpay that this app never heard back about (assessment
  // and package) are settled, and purchases paid with this verified number (before login, or confirmed later by the
  // webhook) become the client's. A purchase recovered here is claimed right after, so it still shows with Start.
  if (user.phone) {
    const deps = paymentDeps();
    const [recovered] = await Promise.all([
      recoverOpenPayments(deps, user.phone),
      claimPurchases(deps, profile, user.phone),
      recoverPackagePayments(profile),
    ]);
    if (recovered > 0) await claimPurchases(deps, profile, user.phone);
  } else {
    await recoverPackagePayments(profile);
  }
  const [{ tests, purchases, attempts }, pkg] = await Promise.all([homeData(profile), packageHome(profile)]);
  const firstName = client.full_name.trim().split(/\s+/)[0] || client.full_name;

  return <ClientHomeView firstName={firstName} fullName={client.full_name} tests={tests} purchases={purchases} attempts={attempts} pkg={pkg} />;
}
