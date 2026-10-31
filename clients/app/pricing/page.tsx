import Link from 'next/link';
import { ContactLines, LegalPage, LegalSection } from '../../components/LegalPage';
import { Card } from '../../components/brand';
import { FeatureList, PriceTag } from '../../components/AssessmentOffer';
import { translations } from '../../lib/i18n';
import { REGULAR_PRICE_PAISE, formatPrice } from '../../lib/payments/service';

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

// Public pricing page: the only place outside the payment step that shows the price,
// kept because the payment gateway requires published pricing.
export default function PricingPage() {
  return (
    <LegalPage
      title="Pricing & Services"
      updated={false}
      intro={
        <p>
          My Fit Brain offers two assessments. Each is a structured assessment
          designed by Dr. Neha Mehta, followed by one consultation with a qualified counsellor.
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
