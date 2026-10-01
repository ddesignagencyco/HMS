export type ComplaintStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_RESPONSE' | 'RESOLVED' | 'REJECTED';
export type ComplaintSeverity = 'SAFETY' | 'HIGH' | 'NORMAL';
export type ComplaintCategory =
  | 'MISBEHAVIOUR'
  | 'QUALITY'
  | 'OVERCHARGE'
  | 'NO_SHOW'
  | 'SAFETY'
  | 'NON_PAYMENT'
  | 'UNSAFE_PREMISES'
  | 'ABUSE'
  | 'CASH_DISCREPANCY'
  | 'OTHER';

/** FR-CP-03: the only legal moves. RESOLVED and REJECTED are final. */
export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['AWAITING_RESPONSE', 'RESOLVED', 'REJECTED'],
  AWAITING_RESPONSE: ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: []
};

export const canMoveComplaint = (from: ComplaintStatus, to: ComplaintStatus): boolean => COMPLAINT_TRANSITIONS[from].includes(to);

export const isComplaintFinal = (status: ComplaintStatus): boolean => COMPLAINT_TRANSITIONS[status].length === 0;

/** Categories a customer may complain about a provider under, and a provider about a customer (FR-CP-01, FR-CP-07). */
export const CUSTOMER_COMPLAINT_CATEGORIES: readonly ComplaintCategory[] = ['MISBEHAVIOUR', 'QUALITY', 'OVERCHARGE', 'NO_SHOW', 'SAFETY', 'CASH_DISCREPANCY', 'OTHER'];
export const PROVIDER_COMPLAINT_CATEGORIES: readonly ComplaintCategory[] = ['NON_PAYMENT', 'UNSAFE_PREMISES', 'ABUSE', 'CASH_DISCREPANCY', 'OTHER'];

/**
 * FR-CP-08: how urgent a complaint is follows from what it is about. Anything that puts a person at risk is SAFETY — first in the
 * queue, one-hour SLA, the admins alerted at once. Conduct and money complaints are HIGH; the rest are ordinary.
 */
export const severityFor = (category: ComplaintCategory): ComplaintSeverity => {
  if (category === 'SAFETY' || category === 'UNSAFE_PREMISES') return 'SAFETY';
  if (category === 'MISBEHAVIOUR' || category === 'ABUSE' || category === 'OVERCHARGE' || category === 'NON_PAYMENT' || category === 'CASH_DISCREPANCY') return 'HIGH';
  return 'NORMAL';
};

const SEVERITY_ORDER: Record<ComplaintSeverity, number> = { SAFETY: 0, HIGH: 1, NORMAL: 2 };

/** Queue order: safety first, then by how soon the SLA runs out. */
export const compareComplaintPriority = (left: { severity: ComplaintSeverity; slaDueAt: Date }, right: { severity: ComplaintSeverity; slaDueAt: Date }): number =>
  SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.slaDueAt.getTime() - right.slaDueAt.getTime();
