import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// STAGING end-to-end check of "Add package payment" (step 6). SKIPPED unless RUN_STAGING_E2E=1:
//   RUN_STAGING_E2E=1 npx vitest run test/staging-e2e-package-manual.test.ts
// It runs the real service code (lib/services/packages.ts recordPackagePayment) against the STAGING database with
// a REAL proof upload to the Google Drive folder (a tiny test image, named by the payment id as always). Only the
// sign-in is replaced: the staff member is the coordinator of the fake client Kiran Test (+91 99999 00007), created
// by supabase/staging/staging-e2e-package-setup.sql. It refuses to run against anything but staging.

const RUN = process.env.RUN_STAGING_E2E === '1';
const KIRAN = '5eed0000-0000-4000-8000-00000006c007';

if (RUN) {
  const file = path.join(__dirname, '../.env.development.local');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    process.env[key] = line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('ndlqjmcpmkkulpinwbxe')) throw new Error('Not staging. Stopping.');
}

// The signed-in staff member: the coordinator of Kiran's purchase (read once from staging).
vi.mock('../lib/auth', () => ({
  requireStaff: async () => {
    const { createAdminClient } = await import('../lib/supabase/admin');
    const db = createAdminClient();
    const { data: purchase } = await db.from('purchases').select('coordinator_id').eq('client_id', KIRAN).eq('kind', 'assessment').single();
    const { data: profile } = await db.from('profiles').select('*').eq('id', purchase!.coordinator_id).single();
    return { profile, isSuperAdmin: false };
  },
}));
// No browser session here: reads that normally use the staff session run on the service role (access rules are
// covered by supabase/staging/staging-test-packages.sql).
vi.mock('../lib/supabase/server', () => ({
  createClient: async () => (await import('../lib/supabase/admin')).createAdminClient(),
}));

// A valid 1×1 PNG.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
);

describe.skipIf(!RUN)('staging: manual package payment with proof', () => {
  it('records the full amount with a real proof in Drive, the Package purchase (with CRM) and the closed Package call', async () => {
    const { createAdminClient } = await import('../lib/supabase/admin');
    const { recordPackagePayment, packageBalanceFor } = await import('../lib/services/packages');
    const db = createAdminClient();
    const { data: purchase } = await db.from('purchases').select('id, coordinator_id').eq('client_id', KIRAN).eq('kind', 'assessment').single();
    const purchaseId = purchase!.id as string;

    const balance = await packageBalanceFor(purchaseId);
    expect(balance, 'Kiran Test needs an open package: run staging-e2e-package-setup.sql (once per database)').not.toBeNull();
    expect(balance!.remaining_paise).toBe(3_150_000);

    const form = new FormData();
    form.set('amount', '31500');
    form.set('method', 'bank_transfer');
    form.set('paidOn', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
    form.set('reference', `E2E-UTR-${Date.now()}`);
    form.set('note', 'Step 6 end-to-end check');
    form.set('proof', new File([PNG], 'proof.png', { type: 'image/png' }));

    // Without a proof nothing is saved.
    const noProof = new FormData();
    for (const [k, v] of form.entries()) if (k !== 'proof') noProof.set(k, v);
    expect(await recordPackagePayment(purchaseId, noProof)).toEqual({ ok: false, error: 'Add the payment proof (screenshot or PDF).' });

    const result = await recordPackagePayment(purchaseId, form);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const [{ data: pay }, { data: pkg }, { data: call }, { data: stage }] = await Promise.all([
      db.from('package_payments').select('*').eq('id', result.paymentId).single(),
      db.from('purchases').select('kind, status, amount_paise, source, coordinator_id, paid_at').eq('parent_purchase_id', purchaseId),
      db.from('calls').select('status, outcome').eq('purchase_id', purchaseId).eq('kind', 'package').single(),
      db.from('purchase_stages').select('status, done_at').eq('purchase_id', purchaseId).eq('stage', 'package_call').single(),
    ]);
    expect(pay).toMatchObject({ provider: 'offline', status: 'paid', amount_paise: 3_150_000, method: 'bank_transfer', accounts_check: 'pending' });
    expect(pay!.proof_url).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(pay!.recorded_by).toBe(purchase!.coordinator_id);
    expect(pkg).toHaveLength(1);
    expect(pkg![0]).toMatchObject({ kind: 'package', status: 'paid', amount_paise: 3_150_000, source: 'manual', coordinator_id: purchase!.coordinator_id });
    expect(call).toEqual({ status: 'closed', outcome: 'package_started' });
    expect(stage!.status).toBe('done');
    expect(new Date(stage!.done_at).getTime()).toBe(new Date(pay!.paid_at).getTime());

    // The package has started: the coordinator can add nothing more (refused before any upload).
    expect(await packageBalanceFor(purchaseId)).toBeNull();
    const second = await recordPackagePayment(purchaseId, form);
    expect(second.ok).toBe(false);

    console.log(
      'Manual package payment on staging:',
      JSON.stringify(
        {
          amount_rupees: pay!.amount_paise / 100,
          method: pay!.method,
          verified_by_coordinator: pay!.recorded_by_name,
          accounts_check: pay!.accounts_check,
          proof_in_drive: pay!.proof_url.startsWith('https://drive.google.com/'),
          package_purchase: pkg![0],
          package_call: call,
          journey_package_call: stage,
          second_payment_refused: second,
        },
        null,
        1
      )
    );
  }, 120_000);
});
