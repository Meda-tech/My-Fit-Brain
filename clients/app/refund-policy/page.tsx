import { ContactLines, LegalPage, LegalSection } from '../../components/LegalPage';

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      intro={
        <p>
          This policy applies to every purchase made on My Fit Brain, operated by MeDa Partners Pvt Ltd. Please read
          it before you pay.
        </p>
      }
    >
      <LegalSection title="No refunds">
        <p>
          <strong>All payments are final and non-refundable.</strong> Once your payment is confirmed, your assessment
          is held for the mobile number you paid with and is ready as soon as you sign in with it. For this reason we
          do not offer refunds, in full or in part, for any reason, including:
        </p>
        <ul>
          <li>if you do not start or do not finish the assessment;</li>
          <li>if you change your mind after paying;</li>
          <li>if you do not attend or do not book the included consultation;</li>
          <li>if you bought the wrong assessment.</li>
        </ul>
      </LegalSection>

      <LegalSection title="No cancellations">
        <p>
          A purchase cannot be cancelled once the payment is confirmed. An assessment cannot be moved to another
          person or exchanged for the other assessment.
        </p>
      </LegalSection>

      <LegalSection title="Failed payments">
        <p>
          If money left your account but the payment did not go through, it is not a purchase. Razorpay and your bank
          return such amounts to your original payment method automatically, usually within 5 to 7 working days.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <ContactLines />
      </LegalSection>
    </LegalPage>
  );
}
