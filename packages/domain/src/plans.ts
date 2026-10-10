import { paisa, type Paisa, splitEvenly, sumPaisa, zero } from './money.js';

export type PlanServiceInput = {
  serviceId: number;
  visitsIncluded: number;
  intervalDays: number;
};

export type ScheduledVisit = {
  serviceId: number;
  dueDate: Date;
  valuePaisa: Paisa;
};

/**
 * Calculates due dates and exact integer paisa valuations for each visit in a maintenance plan.
 * The total plan price is divided across all visits using `splitEvenly` so that the sum of all
 * visits' `valuePaisa` equals `planPricePaisa` exactly (no floating point errors, zero drift).
 */
export const distributePlanVisits = (
  planPricePaisa: bigint,
  services: readonly PlanServiceInput[],
  startDate: Date
): ScheduledVisit[] => {
  const totalVisits = services.reduce((sum, s) => sum + s.visitsIncluded, 0);
  if (totalVisits <= 0) {
    throw new RangeError('Plan must include at least one visit');
  }

  const { parts } = splitEvenly(planPricePaisa, totalVisits);
  const visits: ScheduledVisit[] = [];
  let partIndex = 0;

  for (const service of services) {
    for (let visitNum = 1; visitNum <= service.visitsIncluded; visitNum += 1) {
      // First visit is due at start date + intervalDays, subsequent visits every intervalDays
      const dueDate = new Date(startDate.getTime() + visitNum * service.intervalDays * 86_400_000);
      visits.push({
        serviceId: service.serviceId,
        dueDate,
        valuePaisa: parts[partIndex] ?? zero()
      });
      partIndex += 1;
    }
  }

  return visits;
};

export type VisitRefundItem = {
  status: 'PENDING' | 'BOOKED' | 'CONSUMED' | 'FORFEITED' | 'REFUNDED';
  valuePaisa: bigint;
};

/**
 * Calculates pro-rata refund for a plan cancellation.
 * Only `PENDING` visits that have not been booked, consumed, or forfeited are refundable.
 * The refund amount is the exact sum of the integer paisa allocated to those unused visits.
 */
export const calculatePlanCancellationRefund = (
  visits: readonly VisitRefundItem[]
): { refundableVisitsCount: number; refundPaisa: Paisa } => {
  const pendingVisits = visits.filter(v => v.status === 'PENDING');
  const refundPaisa = sumPaisa(pendingVisits.map(v => paisa(v.valuePaisa)));
  return {
    refundableVisitsCount: pendingVisits.length,
    refundPaisa
  };
};
