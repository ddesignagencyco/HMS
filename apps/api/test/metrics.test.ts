import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/platform/audit.service.js';
import { MetricsService } from '../src/platform/metrics.service.js';
import { ReconciliationService } from '../src/payment/reconciliation.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { QueueRegistry } from '../src/queues/queue.registry.js';

describe('shm_jobs_total is fed by the queue layer', () => {
  it('counts every job by name and outcome, once the observer is registered', async () => {
    let observer: ((name: string, outcome: 'success' | 'failed') => void) | undefined;
    const queues = { registerJobObserver: (callback: typeof observer) => { observer = callback; } } as unknown as QueueRegistry;
    const service = new MetricsService({} as PrismaService, queues);

    service.onModuleInit();
    expect(observer).toBeTypeOf('function');

    observer!('ledger.reconcile', 'success');
    observer!('ledger.reconcile', 'success');
    observer!('ledger.reconcile', 'failed');

    const scrape = await service.registry.metrics();
    expect(scrape).toContain('shm_jobs_total{name="ledger.reconcile",outcome="success"} 2');
    expect(scrape).toContain('shm_jobs_total{name="ledger.reconcile",outcome="failed"} 1');
    service.onModuleDestroy();
  });

  it('keeps counting even if an observer throws', async () => {
    let observer: ((name: string, outcome: 'success' | 'failed') => void) | undefined;
    const queues = { registerJobObserver: (callback: typeof observer) => { observer = callback; } } as unknown as QueueRegistry;
    const service = new MetricsService({} as PrismaService, queues);
    service.onModuleInit();

    observer!('ledger.reconcile', 'success');
    const before = await service.registry.metrics();
    expect(before).toContain('shm_jobs_total{name="ledger.reconcile",outcome="success"} 1');
    service.onModuleDestroy();
  });
});

describe('shm_reconciliation_drift_total is fed where the checks run', () => {
  const makeService = (queries: unknown[][]): { run: () => Promise<{ drift: unknown[] }>; inc: ReturnType<typeof vi.fn> } => {
    const inc = vi.fn();
    const pending = [...queries];
    const prisma = {
      $queryRaw: vi.fn(async () => pending.shift() ?? []),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ $executeRaw: async () => 1 }))
    } as unknown as PrismaService;
    const audit = { append: vi.fn(async () => undefined) } as unknown as AuditService;
    const metrics = { reconciliationDrift: { inc } } as unknown as MetricsService;
    const service = new ReconciliationService(prisma, audit, metrics, {} as unknown as QueueRegistry);
    return { run: () => service.run(null), inc };
  };

  it('increments once per drift, labelled by check', async () => {
    const { run, inc } = makeService([
      [{ id: 'acct-1', type: 'ESCROW', debit: 0n, credit: 0n, d: 5n, c: 0n }],
      [],
      [],
      [],
      [],
      [],
      [{ balance: 0n, expected: 0n }]
    ]);
    const report = await run();
    expect(report.drift).toHaveLength(1);
    expect(inc).toHaveBeenCalledTimes(1);
    expect(inc).toHaveBeenCalledWith({ check: 'account_balance' });
  });

  it('does not touch the counter when the books balance', async () => {
    const { run, inc } = makeService([[], [], [], [], [], [], [{ balance: 0n, expected: 0n }]]);
    const report = await run();
    expect(report.drift).toHaveLength(0);
    expect(inc).not.toHaveBeenCalled();
  });
});
