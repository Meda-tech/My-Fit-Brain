import { STAGE_LABELS, paymentStage, type PaymentListRow } from './services/payments';
import { assessmentLabel, paymentLabel } from '../components/payments/PaymentStatusPill';
import { clientName } from '../components/payments/format';

// The five summary values of a purchase, shared by the Excel export and the Google Sheets sync so both
// always say the same thing.

export interface PaymentSummaryFields {
  status: string;
  payment: string;
  assessment: string;
  name: string;
  mobile: string;
}

export function paymentSummaryFields(p: PaymentListRow): PaymentSummaryFields {
  return {
    status: STAGE_LABELS[paymentStage(p)],
    payment: paymentLabel(p).label,
    assessment: assessmentLabel(p)?.label ?? '',
    name: clientName(p) ?? 'Not logged in yet',
    mobile: p.phone,
  };
}
