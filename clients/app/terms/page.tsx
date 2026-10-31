import Link from 'next/link';
import { ContactLines, LegalPage, LegalSection } from '../../components/LegalPage';
import { BUSINESS } from '../../lib/legal';

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro={
        <p>
          These terms apply when you use My Fit Brain Assessments at myfitbrain.app (the &ldquo;service&rdquo;).
          My Fit Brain is operated by {BUSINESS.legalName}, {BUSINESS.address} (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By signing in or paying, you agree to these terms.
        </p>
      }
    >
      <LegalSection title="1. The service">
        <p>
          We offer the MFB Intimacy Assessment and the MFB Mind Assessment. Each is a structured assessment designed
          by Dr. Neha Mehta, followed by one consultation with a qualified counsellor. The assessment is a screening
          that helps your counsellor prepare for your consultation.
        </p>
        <p>
          The service is not a medical examination or treatment, does not replace care from a doctor or psychiatrist,
          and we cannot promise any particular result.
        </p>
      </LegalSection>

      <LegalSection title="2. Not an emergency service">
        <p>
          We do not offer emergency or crisis care. If you feel unsafe or are thinking of harming yourself, call
          Tele-MANAS on <a href="tel:14416">14416</a> or <a href="tel:18008914416">1-800-891-4416</a> (free, 24
          hours), or <a href="tel:112">112</a> in an emergency. If you tell us in the assessment that you are not
          safe, our team may contact you on your registered number.
        </p>
      </LegalSection>

      <LegalSection title="3. Who can use it">
        <ul>
          <li>You must be 18 years or older.</li>
          <li>You sign in with your own mobile number and a one-time code (OTP). Keep your phone and code private.</li>
          <li>Each assessment is for one person only. A partner takes and pays for their own; reports are never linked.</li>
          <li>The details you give at registration and in the assessment must be true and your own.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Price and payment">
        <p>
          The price is shown on our <Link href="/pricing">Pricing</Link> page and on the payment screen before you
          pay. Payments are made in Indian Rupees through Razorpay. We never see or store your card, UPI or bank
          details. Your assessment opens once the payment is confirmed.
        </p>
      </LegalSection>

      <LegalSection title="5. No refunds or cancellations">
        <p>
          All payments are final. We do not offer refunds or cancellations. See our{' '}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="6. Taking the assessment">
        <ul>
          <li>Questions appear one at a time, in English or Hindi. Your answers are saved as you go.</li>
          <li>Once you submit, nothing can be changed.</li>
          <li>Your report is prepared for our care team. It is not shown in the app. Your counsellor goes through your results with you in the consultation and can share the report with you on request.</li>
          <li>Our team contacts you to arrange the consultation included in your purchase.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Your information">
        <p>
          How we collect, use and protect your information is explained in our{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="8. Fair use">
        <p>
          Do not misuse the service: no sharing your account, using someone else&rsquo;s number, trying to get into
          parts of the service you are not meant to, or copying the questions, reports or design. All content of the
          service belongs to {BUSINESS.legalName}.
        </p>
      </LegalSection>

      <LegalSection title="9. Limits of our responsibility">
        <p>
          We take care to keep the service accurate and available, but it is provided as it is. To the extent the law
          allows, our total responsibility for any claim about a purchase is limited to the amount you paid for it. We
          are not responsible for delays or failures caused by things outside our control, such as network, bank or
          payment-provider problems.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes and governing law">
        <p>
          We may update these terms. The date at the top shows the latest version; a purchase is governed by the terms
          in force when you paid. These terms are governed by the laws of India, and the courts at Hisar, Haryana have
          jurisdiction.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <ContactLines />
      </LegalSection>
    </LegalPage>
  );
}
