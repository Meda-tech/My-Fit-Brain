import { Mail, MapPin, Phone } from 'lucide-react';
import { LegalPage } from '../../components/LegalPage';
import { Card } from '../../components/brand';
import { BUSINESS } from '../../lib/legal';

const ROWS = [
  { icon: Mail, label: 'Email', value: BUSINESS.email, href: `mailto:${BUSINESS.email}` },
  { icon: Phone, label: 'Phone', value: BUSINESS.phoneDisplay, href: BUSINESS.phoneHref },
  { icon: MapPin, label: 'Address', value: BUSINESS.address },
];

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact Us"
      updated={false}
      intro={<p>Questions about your assessment, a payment or your information? We are here to help.</p>}
    >
      <Card className="divide-y divide-sand">
        <div className="p-6">
          <p className="font-heading text-[20px] font-medium text-ink">{BUSINESS.brand}</p>
          <p className="mt-1 text-[15px] text-ink-soft">Operated by {BUSINESS.legalName}</p>
        </div>
        {ROWS.map(({ icon: Icon, label, value, href }) => (
          <div key={label} className="flex items-start gap-4 p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mist text-teal">
              <Icon size={20} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</p>
              {href ? (
                <a href={href} className="mt-0.5 block break-words text-[17px] font-medium text-teal underline-offset-2 hover:underline">
                  {value}
                </a>
              ) : (
                <p className="mt-0.5 text-[17px] text-ink">{value}</p>
              )}
            </div>
          </div>
        ))}
      </Card>

      <p className="text-[15px] leading-6 text-ink-soft">
        For a payment question, please share your registered mobile number and the Razorpay payment ID so we can
        help you faster.
      </p>

      <p className="text-[15px] leading-6 text-ink-soft">
        <strong className="font-semibold text-ink">Need help right now?</strong> We are not an emergency service. If
        you feel unsafe or are thinking of harming yourself, call Tele-MANAS on{' '}
        <a href="tel:14416" className="font-medium text-teal underline underline-offset-2">14416</a> or{' '}
        <a href="tel:18008914416" className="font-medium text-teal underline underline-offset-2">1-800-891-4416</a>{' '}
        (free, 24 hours), or{' '}
        <a href="tel:112" className="font-medium text-teal underline underline-offset-2">112</a> in an emergency.
      </p>
    </LegalPage>
  );
}
