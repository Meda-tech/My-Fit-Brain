import { ContactLines, LegalPage, LegalSection } from '../../components/LegalPage';
import { BUSINESS } from '../../lib/legal';

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          Your information stays private. This policy explains what My Fit Brain, operated by {BUSINESS.legalName},
          collects when you use My Fit Brain Assessments, why, and who can see it. It follows India&rsquo;s Digital
          Personal Data Protection Act, 2023.
        </p>
      }
    >
      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Mobile number</strong> to sign you in with a one-time code (OTP) and to contact you about your
            consultation. If you pay before signing in, we keep the number you paid with, so your assessment is ready
            when you sign in with it.
          </li>
          <li>
            <strong>Registration details:</strong> your name, gender, age, relationship status, and, if you give
            them, your city, state and email address.
          </li>
          <li>
            <strong>Assessment answers:</strong> the options you choose, your answers to the safety questions, and
            the short typed answers you give at the end of the assessment. From these we prepare a report for our care
            team.
          </li>
          <li>
            <strong>Payment records:</strong> the Razorpay order and payment IDs, amount, payment method type, status
            and time. Your card, UPI or bank details go directly to Razorpay; we never see or store them. To stop misuse
            of the payment page, we keep a scrambled code made from your internet address (never the address itself).
          </li>
          <li>
            <strong>Cookies:</strong> only what the app needs to keep you signed in and remember your language. We do
            not use advertising or tracking cookies.
          </li>
        </ul>
        <p>We do not ask anyone under 18 to register; if you are under 18, we stop and save nothing.</p>
      </LegalSection>

      <LegalSection title="Why we use it">
        <ul>
          <li>To sign you in and run your assessment.</li>
          <li>To prepare your consultation with a qualified counsellor.</li>
          <li>To reach you quickly if your answers show you may not be safe.</li>
          <li>To process and record your payment, and to meet legal and accounting duties.</li>
        </ul>
        <p>
          We do not sell your information, use it for advertising, or send you marketing messages. Messages from us
          say only &ldquo;MFB Assessment&rdquo;.
        </p>
      </LegalSection>

      <LegalSection title="Your consent">
        <p>
          We ask for your consent before the assessment starts. You can withdraw it at any time by writing to us;
          we will then stop using your information for the assessment, except where the law requires us to keep it.
        </p>
      </LegalSection>

      <LegalSection title="Who can see it">
        <ul>
          <li>
            <strong>Your counsellor and our senior care team</strong> can see your answers and report.
          </li>
          <li>
            <strong>Our coordinators</strong> can see your contact details, payment status and any safety alert, so
            they can arrange your consultation and reach you when needed. They cannot see your answers.
          </li>
          <li>
            <strong>You</strong> see your own profile and payment receipt in the app. Your counsellor can share your
            report with you on request.
          </li>
          <li>
            <strong>Service providers</strong> who help us run the service, only for that purpose: secure cloud
            hosting and database, the SMS provider that sends your OTP, and Razorpay for payments.
          </li>
        </ul>
        <p>We share information with authorities only when the law requires it.</p>
      </LegalSection>

      <LegalSection title="How we protect it">
        <p>
          Your information is sent over encrypted connections and kept in a secured database with strict access
          rules, so each person on our team sees only what their role needs. Scoring happens on our servers, and
          finished assessments cannot be altered.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your profile, assessments and reports for as long as you use our services, so your counsellor can
          refer back to them. Payment records are kept for as long as Indian tax and accounting law requires.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what information we hold about you;</li>
          <li>correct or update it;</li>
          <li>erase it, except records we must keep by law, such as payment records;</li>
          <li>name someone to act for you if you are unable to.</li>
        </ul>
        <p>Write to us from your registered details and we will reply within 30 days.</p>
      </LegalSection>

      <LegalSection title="Grievances and contact">
        <p>For any question or complaint about your information, contact our grievance team:</p>
        <ContactLines />
        <p>We may update this policy; the date at the top shows the latest version.</p>
      </LegalSection>
    </LegalPage>
  );
}
