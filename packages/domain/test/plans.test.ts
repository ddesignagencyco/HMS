import { describe, expect, it } from 'vitest';
import { calculatePlanCancellationRefund, distributePlanVisits } from '../src/plans.js';

describe('distributePlanVisits', () => {
  it('distributes visits with exact paisa integrity (no remainder loss)', () => {
    const planPrice = 100_000n; // 100,000 paisa (PKR 1,000)
    const services = [
      { serviceId: 1, visitsIncluded: 2, intervalDays: 30 },
      { serviceId: 2, visitsIncluded: 1, intervalDays: 60 }
    ];
    const startDate = new Date('2026-01-01T00:00:00.000Z');

    const visits = distributePlanVisits(planPrice, services, startDate);

    expect(visits).toHaveLength(3);
    // 100,000 / 3 parts = 33,334 + 33,333 + 33,333 = 100,000
    const sum = visits.reduce((acc, v) => acc + v.valuePaisa, 0n);
    expect(sum).toBe(planPrice);

    expect(visits[0]?.serviceId).toBe(1);
    expect(visits[0]?.dueDate).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    expect(visits[0]?.valuePaisa).toBe(33_334n);

    expect(visits[1]?.serviceId).toBe(1);
    expect(visits[1]?.dueDate).toEqual(new Date('2026-03-02T00:00:00.000Z'));
    expect(visits[1]?.valuePaisa).toBe(33_333n);

    expect(visits[2]?.serviceId).toBe(2);
    expect(visits[2]?.dueDate).toEqual(new Date('2026-03-02T00:00:00.000Z'));
    expect(visits[2]?.valuePaisa).toBe(33_333n);
  });

  it('rejects an empty plan with zero visits', () => {
    expect(() => distributePlanVisits(50_000n, [], new Date())).toThrow(RangeError);
  });
});

describe('calculatePlanCancellationRefund', () => {
  it('refunds only pending visits with exact paisa accuracy', () => {
    const visits = [
      { status: 'CONSUMED' as const, valuePaisa: 33_334n },
      { status: 'BOOKED' as const, valuePaisa: 33_333n },
      { status: 'PENDING' as const, valuePaisa: 33_333n }
    ];

    const result = calculatePlanCancellationRefund(visits);
    expect(result.refundableVisitsCount).toBe(1);
    expect(result.refundPaisa).toBe(33_333n);
  });

  it('refunds all visits if all are pending', () => {
    const visits = [
      { status: 'PENDING' as const, valuePaisa: 25_000n },
      { status: 'PENDING' as const, valuePaisa: 25_000n }
    ];

    const result = calculatePlanCancellationRefund(visits);
    expect(result.refundableVisitsCount).toBe(2);
    expect(result.refundPaisa).toBe(50_000n);
  });

  it('refunds zero if no visits are pending', () => {
    const visits = [
      { status: 'CONSUMED' as const, valuePaisa: 50_000n },
      { status: 'REFUNDED' as const, valuePaisa: 50_000n }
    ];

    const result = calculatePlanCancellationRefund(visits);
    expect(result.refundableVisitsCount).toBe(0);
    expect(result.refundPaisa).toBe(0n);
  });
});
