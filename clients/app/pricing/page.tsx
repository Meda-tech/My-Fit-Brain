import Link from 'next/link';
import { ContactLines, LegalPage, LegalSection } from '../../components/LegalPage';
import { Card } from '../../components/brand';
import { FeatureList, PriceTag } from '../../components/AssessmentOffer';
import { translations } from '../../lib/i18n';
import { REGULAR_PRICE_PAISE, formatPrice } from '../../lib/payments/service';
import { publicPackage } from '../../lib/package/server';

const PRICE = formatPrice();
const REGULAR_PRICE = formatPrice(REGULAR_PRICE_PAISE);
const t = translations.en.pay;

const SERVICES = [
  {
    name: 'MFB Intimacy Assessment',
    about:
      'A private, structured assessment of your relationship and intimate life: relationship health, communication, emotional closeness and desire, confidence, past hurt and trust, and stress and mood.',
  },
  {
    name: 'MFB Mind Assessment',
    about:
      'A private, structured assessment of your everyday wellbeing: worry, low mood and energy, work stress and burnout, and studies and career pressure.',
  },
];

// Read on each request: the package price comes from Admin → Settings.
export const dynamic = 'force-dynamic';

// Public pricing page: the only place outside the payment step that shows the price,
// kept because the payment gateway requires published pricing (every product, the package too).
export default async function PricingPage() {
  const pkg = await publicPackage();
  return (
    <LegalPage
      title="Pricing & Services"
      updated={false}
      intro={
        <p>
          My Fit Brain offers two assessments. Each is a structured assessment
          designed by Dr. Neha Mehta, followed by one consultation with a qualified counsellor. After your report
          presentation, you can choose a counselling package.
        </p>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {SERVICES.map((service) => (
          <Card key={service.name} className="flex flex-col p-6">
            <h2 className="text-[20px] font-medium leading-[1.3] text-ink">{service.name}</h2>
            <p className="mt-1 text-[14px] text-ink-muted">Designed by Dr. Neha Mehta</p>
            <p className="mt-4 flex-1 text-[15px] leading-6 text-ink-soft">{service.about}</p>
            <PriceTag className="mt-5" price={PRICE} regular={REGULAR_PRICE} regularLabel={t.regularPrice} offerLabel={t.offerPrice} />
            <p className="mt-2 text-[14px] text-ink-muted">One-time payment, in Indian Rupees</p>
          </Card>
        ))}
      </div>

      {pkg && (
        <Card className="p-6">
          <h2 className="text-[20px] font-medium leading-[1.3] text-ink">Counselling package</h2>
          <p className="mt-1 text-[14px] text-ink-muted">Offered after your report presentation</p>
          <p className="mt-4 text-[15px] leading-6 text-ink-soft">
            {pkg.sessions} sessions with a qualified counsellor, {pkg.frequency.toLowerCase()}, based on your assessment. Taking the
            package is your choice.
          </p>
          <dl className="mt-5 grid max-w-sm gap-2 text-[15px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-soft">Package price</dt>
              <dd className="m-0 font-medium text-ink">{pkg.price}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-soft">Assessment payment, counted as advance</dt>
              <dd className="m-0 font-medium text-ink">− {pkg.advance}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-sand pt-2">
              <dt className="font-semibold text-ink">You pay</dt>
              <dd className="m-0 font-heading text-[20px] font-semibold text-teal">{pkg.amount}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[14px] text-ink-muted">One-time full payment, in Indian Rupees. No subscriptions or renewals.</p>
        </Card>
      )}

      <LegalSection title="What the price includes">
        <FeatureList title={t.featuresTitle} items={t.features} />
        <p>There are no subscriptions, renewals or hidden charges.</p>
      </LegalSection>

      <LegalSection title="How the service is delivered">
        <ul>
          <li>Everything happens online. Nothing is shipped.</li>
          <li>Pay securely through Razorpay (UPI, card, net banking or wallet) with your mobile number.</li>
          <li>Sign in with the same number and start the assessment. You can finish it at your own pace.</li>
          <li>After you submit, our team contacts you to arrange your consultation.</li>
          <li>If you take the counselling package, you pay for it in the app after your report presentation, and our team schedules your sessions.</li>
        </ul>
        <p>
          Each assessment is for one person. A partner who wants to take it does so with their own account and
          payment.
        </p>
      </LegalSection>

      <LegalSection title="Payments and refunds">
        <p>
          All payments are final. Please read our <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>{' '}
          and <Link href="/terms">Terms &amp; Conditions</Link> before you pay.
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <ContactLines />
      </LegalSection>
    </LegalPage>
  );
}
