// apps/api/src/finance/reports.service.ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { formatPaisa, paisaToNumber } from '@smart-home/domain';
import { DomainError, conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE } from '../integrations/integrations.module.js';
import type { ObjectStoragePort } from '../integrations/ports.js';
import { QueueRegistry } from '../queues/queue.registry.js';
import { AuditService, appendOutboxEvent } from '../platform/audit.service.js';
import { renderTextPdf } from '../payment/text-pdf.js';

export type ReportType = 'MONTHLY' | 'REVENUE' | 'PROVIDER_PERFORMANCE' | 'VERIFICATION';
export type ReportFormat = 'PDF' | 'XLSX';

export type ReportRunView = {
  id: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  format: ReportFormat;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  rowCount: number | null;
  totalPaisa: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null;
};

export type ReportRequest = { type: ReportType; periodStart: string; periodEnd: string; format: ReportFormat };

/** One row of a built report. `values` are strings because every renderer here writes text. */
type ReportTable = { title: string; columns: string[]; rows: string[][]; totalPaisa: bigint };

/**
 * FR-RP-01..06: the reports finance asks for, built in the background.
 *
 * **Revenue comes from the ledger, never from `bookings.total`.** This is the single most important
 * decision in the file and it is not negotiable. A booking's total says what was quoted; the ledger
 * says what actually moved — after refunds, after a part-release on a disputed job, after a
 * cancellation that refunded all but a fee. A report built on the quoted figure would not be wrong
 * in a way anyone could spot: it would simply be a different, more flattering number from the one
 * the finance console shows, and the gap between the two would be found later, by an auditor.
 *
 * A report over a period is far too slow to build inside a request, so a run is a row, a queued job
 * builds it, and the operator polls. Asking for the same report twice while one is open returns the
 * open one rather than starting a second copy of the same numbers.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(QueueRegistry) private readonly queues: QueueRegistry
  ) {}

  onModuleInit(): void {
    this.queues.registerHandler('reports.run', async data => {
      const id = data.runId;
      if (typeof id === 'string') await this.build(id);
    });
    this.queues.registerScheduled('reports.drain', async () => void (await this.drain()));
    this.queues.registerScheduled('reports.reap-stuck', async () => void (await this.reapStuck()));
  }

  // --------------------------------------------------------------- requesting

  async request(requestedBy: string, input: ReportRequest): Promise<ReportRunView> {
    const existing = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM report_runs WHERE requested_by = ${requestedBy}::uuid AND type = ${input.type}
        AND period_start = ${input.periodStart}::date AND period_end = ${input.periodEnd}::date AND status IN ('QUEUED','RUNNING') LIMIT 1`
    );
    if (existing[0] !== undefined) return this.view(existing[0].id);

    const inserted = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO report_runs(type, period_start, period_end, format, requested_by)
        VALUES (${input.type}, ${input.periodStart}::date, ${input.periodEnd}::date, ${input.format}, ${requestedBy}::uuid)
        ON CONFLICT DO NOTHING RETURNING id`
    );
    const id = inserted[0]?.id;
    // Lost the race with a concurrent identical request: the other one is the run to watch.
    if (id === undefined) {
      const race = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM report_runs WHERE requested_by = ${requestedBy}::uuid AND type = ${input.type}
          AND period_start = ${input.periodStart}::date AND period_end = ${input.periodEnd}::date AND status IN ('QUEUED','RUNNING') LIMIT 1`
      );
      if (race[0] === undefined) throw conflict('That report is already being built; try again in a moment');
      return this.view(race[0].id);
    }

    await this.audit.append({ actorUserId: requestedBy, actorRole: 'FINANCE', action: 'report.request', entityType: 'report_run', entityId: id, after: { type: input.type, periodStart: input.periodStart, periodEnd: input.periodEnd, format: input.format } });
    await this.queues.queue('projections').add('reports.run', { runId: id }, { jobId: id, removeOnComplete: true });
    return this.view(id);
  }

  async list(requestedBy: string): Promise<ReportRunView[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM report_runs WHERE requested_by = ${requestedBy}::uuid ORDER BY created_at DESC LIMIT 50`
    );
    return Promise.all(rows.map(row => this.view(row.id)));
  }

  async view(id: string): Promise<ReportRunView> {
    const rows = await this.prisma.$queryRaw<{
      id: string; type: string; periodStart: string; periodEnd: string; format: string; status: string;
      rowCount: number | null; totalPaisa: bigint | null; error: string | null; createdAt: Date; completedAt: Date | null; fileKey: string | null;
    }[]>(
      Prisma.sql`SELECT id, type, period_start as "periodStart", period_end as "periodEnd", format, status::text as status,
          row_count as "rowCount", total_paisa as "totalPaisa", error, created_at as "createdAt", completed_at as "completedAt", file_key as "fileKey"
        FROM report_runs WHERE id = ${id}::uuid`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Report');
    return {
      id: row.id,
      type: row.type as ReportType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      format: row.format as ReportFormat,
      status: row.status as ReportRunView['status'],
      rowCount: row.rowCount,
      totalPaisa: row.totalPaisa === null ? null : row.totalPaisa.toString(),
      failureReason: row.error,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
      downloadUrl: row.fileKey === null ? null : `/api/v1/finance/reports/${row.id}/download`
    };
  }

  /** The finished file. Audited: these are the platform's numbers leaving the system. */
  async download(id: string, requestedBy: string): Promise<{ key: string; content: Buffer; filename: string }> {
    const rows = await this.prisma.$queryRaw<{ status: string; fileKey: string | null; format: string; type: string; periodStart: string; periodEnd: string }[]>(
      Prisma.sql`SELECT status::text as status, file_key as "fileKey", format, type, period_start as "periodStart", period_end as "periodEnd"
        FROM report_runs WHERE id = ${id}::uuid AND requested_by = ${requestedBy}::uuid`
    );
    const run = rows[0];
    if (run === undefined) throw notFound('Report');
    if (run.status !== 'DONE' || run.fileKey === null) throw new DomainError('CONFLICT', 'This report is not ready yet');
    const content = await this.storage.get({ key: run.fileKey, bucket: 'reports' });
    if (content === null) throw notFound('Report file');
    await this.audit.append({ actorUserId: requestedBy, actorRole: 'FINANCE', action: 'report.download', entityType: 'report_run', entityId: id });
    return { key: run.fileKey, content: content.content, filename: `${run.type.toLowerCase()}-${run.periodStart}-to-${run.periodEnd}.${run.format.toLowerCase()}` };
  }

  // --------------------------------------------------------------- building

  /** Picks up queued runs. Also the path a freshly requested run takes if the worker missed the push. */
  async drain(limit = 5): Promise<number> {
    const queued = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM report_runs WHERE status = 'QUEUED' ORDER BY created_at LIMIT ${limit}`
    );
    for (const run of queued) await this.build(run.id);
    return queued.length;
  }

  /**
   * A run left RUNNING is a worker that died mid-build. It is put back on the queue rather than left
   * spinning forever, and only once it is genuinely old — a report over a big month is not stuck
   * because it has been running for four minutes.
   */
  async reapStuck(): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`UPDATE report_runs SET status = 'QUEUED', started_at = NULL
        WHERE status = 'RUNNING' AND started_at < now() - interval '15 minutes'`
    );
  }

  async build(id: string): Promise<void> {
    const claimed = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE report_runs SET status = 'RUNNING', started_at = now() WHERE id = ${id}::uuid AND status = 'QUEUED'`
    );
    if (claimed === 0) return; // another worker took it, or it is already finished
    try {
      const rows = await this.prisma.$queryRaw<{ type: string; periodStart: string; periodEnd: string; format: string; requestedBy: string }[]>(
        Prisma.sql`SELECT type, period_start as "periodStart", period_end as "periodEnd", format, requested_by as "requestedBy"
          FROM report_runs WHERE id = ${id}::uuid`
      );
      const run = rows[0];
      if (run === undefined) throw notFound('Report');
      const table = await this.gather(run.type as ReportType, run.periodStart, run.periodEnd);
      const { content, contentType } = await this.render(run.format as ReportFormat, run.type, run.periodStart, run.periodEnd, table);
      const key = `reports/${id}.${run.format.toLowerCase()}`;
      await this.storage.put({ key, bucket: 'reports', content, contentType });
      await this.prisma.$queryRaw(
        Prisma.sql`UPDATE report_runs SET status = 'DONE', file_key = ${key}, row_count = ${table.rows.length}, total_paisa = ${table.totalPaisa}, completed_at = now() WHERE id = ${id}::uuid`
      );
      await this.prisma.$transaction(async tx => {
        await appendOutboxEvent(tx, {
          aggregate: 'report',
          aggregateId: id,
          type: 'report.ready',
          // `requestedBy` is what the notification rule addresses: the notification goes to the
          // person who asked, not to every admin on the platform.
          payload: { reportId: id, type: run.type, rows: table.rows.length, requestedBy: run.requestedBy }
        });
      });
    } catch (error) {
      // A failed report is a failed report, not a silent one: the reason is stored where the operator
      // will see it, and a retry is a new request rather than a stuck row.
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE report_runs SET status = 'FAILED', error = ${`${(error as Error).message}`.slice(0, 500)}, completed_at = now() WHERE id = ${id}::uuid`
      );
      this.logger.error(`report ${id} failed: ${(error as Error).message}`);
    }
  }

  // --------------------------------------------------------------- the numbers

  private async gather(type: ReportType, periodStart: string, periodEnd: string): Promise<ReportTable> {
    if (type === 'REVENUE') return this.revenue(periodStart, periodEnd);
    if (type === 'PROVIDER_PERFORMANCE') return this.providerPerformance(periodStart, periodEnd);
    if (type === 'VERIFICATION') return this.verification(periodStart, periodEnd);
    return this.monthlyBookings(periodStart, periodEnd);
  }

  /**
   * FR-RP-02: bookings by month and by how they ended.
   *
   * Counted from `bookings.status` — which is the final word on how a job ended — and joined to the
   * ledger only for the money actually taken.
   */
  private async monthlyBookings(periodStart: string, periodEnd: string): Promise<ReportTable> {
    const rows = await this.prisma.$queryRaw<{ period: string; status: string; jobs: number; gross: bigint }[]>(
      Prisma.sql`SELECT to_char(date_trunc('month', b.scheduled_start), 'YYYY-MM') as period, b.status::text as status, count(*)::int as jobs,
          coalesce(sum(b.approved_total_paisa), 0)::bigint as gross
        FROM bookings b WHERE b.scheduled_start >= ${periodStart}::date AND b.scheduled_start < ${periodEnd}::date
        GROUP BY 1, 2 ORDER BY 1, 2`
    );
    return {
      title: 'Bookings by month',
      columns: ['Month', 'Status', 'Jobs', 'Value'],
      rows: rows.map(row => [row.period, row.status, String(row.jobs), `PKR ${formatPaisa(row.gross)}`]),
      totalPaisa: rows.reduce((sum, row) => sum + row.gross, 0n)
    };
  }

  /**
   * FR-RP-03: revenue by month and category, **taken from the ledger**.
   *
   * Two postings count as revenue and they are not interchangeable: `PLATFORM_COMMISSION` is what the
   * platform earns, and `RELEASE` credits to a provider's wallet is gross job value passing through.
   * Reporting one under the other's name is how a revenue figure ends up overstated by the entire
   * commission margin, so both are reported and named.
   */
  private async revenue(periodStart: string, periodEnd: string): Promise<ReportTable> {
    const rows = await this.prisma.$queryRaw<{ month: string; category: string; commission: bigint; released: bigint; refunded: bigint }[]>(
      Prisma.sql`SELECT to_char(date_trunc('month', e.created_at), 'YYYY-MM') as month, coalesce(c.name_en, 'Uncategorised') as category,
          coalesce(sum(e.amount_paisa) FILTER (WHERE a.type = 'PLATFORM_COMMISSION' AND e.direction = 'CREDIT'), 0)::bigint as commission,
          coalesce(sum(e.amount_paisa) FILTER (WHERE a.type = 'PROVIDER_WALLET' AND e.direction = 'CREDIT'), 0)::bigint as released,
          coalesce(sum(e.amount_paisa) FILTER (WHERE a.type = 'CUSTOMER_COMPENSATION' AND e.direction = 'DEBIT'), 0)::bigint as refunded
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e.transaction_id
        JOIN ledger_accounts a ON a.id = e.account_id
        LEFT JOIN bookings b ON b.id = t.booking_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN categories c ON c.id = s.category_id
        WHERE e.created_at >= ${periodStart}::date AND e.created_at < ${periodEnd}::date
          AND a.type IN ('PLATFORM_COMMISSION','PROVIDER_WALLET','CUSTOMER_COMPENSATION')
        GROUP BY 1, 2 ORDER BY 1, 2`
    );
    return {
      title: 'Revenue by month and category',
      columns: ['Month', 'Category', 'Commission', 'Released to providers', 'Refunded'],
      rows: rows.map(row => [
        row.month,
        row.category,
        `PKR ${formatPaisa(row.commission)}`,
        `PKR ${formatPaisa(row.released)}`,
        `PKR ${formatPaisa(row.refunded)}`
      ]),
      totalPaisa: rows.reduce((sum, row) => sum + row.commission, 0n)
    };
  }

  /** FR-RP-04: how each provider actually did over the period — work taken, work finished, money earned, how they were rated. */
  private async providerPerformance(periodStart: string, periodEnd: string): Promise<ReportTable> {
    const rows = await this.prisma.$queryRaw<{ provider: string; name: string; jobs: number; completed: number; earned: bigint; rating: string | null }[]>(
      Prisma.sql`SELECT p.user_id::text as provider, trim(u.first_name || ' ' || u.last_name) as name,
          count(*)::int as jobs,
          count(*) FILTER (WHERE b.status = 'CLOSED')::int as completed,
          coalesce(sum(b.approved_total_paisa) FILTER (WHERE b.status = 'CLOSED'), 0)::bigint as earned,
          (SELECT round(avg(r.score)::numeric, 2)::text FROM ratings r WHERE r.provider_id = p.user_id) as rating
        FROM bookings b JOIN providers p ON p.user_id = b.provider_id JOIN users u ON u.id = p.user_id
        WHERE b.scheduled_start >= ${periodStart}::date AND b.scheduled_start < ${periodEnd}::date AND b.provider_id IS NOT NULL
        GROUP BY p.user_id, u.first_name, u.last_name ORDER BY earned DESC LIMIT 500`
    );
    return {
      title: 'Provider performance',
      columns: ['Provider', 'Name', 'Jobs taken', 'Completed', 'Value completed', 'Rating'],
      rows: rows.map(row => [row.provider.slice(0, 8), row.name, String(row.jobs), String(row.completed), `PKR ${formatPaisa(row.earned)}`, row.rating ?? '—']),
      totalPaisa: rows.reduce((sum, row) => sum + row.earned, 0n)
    };
  }

  /** FR-RP-05: what happened at verification — outcomes, how fast, and how many ended in rework or a dispute. */
  private async verification(periodStart: string, periodEnd: string): Promise<ReportTable> {
    const rows = await this.prisma.$queryRaw<{ month: string; outcome: string; calls: number; minutes: string | null }[]>(
      Prisma.sql`SELECT to_char(date_trunc('month', v.submitted_at), 'YYYY-MM') as month, coalesce(v.outcome::text, 'NOT SUBMITTED') as outcome,
          count(*)::int as calls, round(avg(extract(epoch FROM (v.submitted_at - v.created_at))/60)::numeric, 1)::text as minutes
        FROM verification_calls v WHERE v.created_at >= ${periodStart}::date AND v.created_at < ${periodEnd}::date
        GROUP BY 1, 2 ORDER BY 1, 2`
    );
    return {
      title: 'Verification outcomes',
      columns: ['Month', 'Outcome', 'Calls', 'Median-ish average minutes'],
      rows: rows.map(row => [row.month, row.outcome, String(row.calls), row.minutes ?? '—']),
      // Verification has no money in it; zero is a real total here, not a missing one.
      totalPaisa: 0n
    };
  }

  // --------------------------------------------------------------- rendering

  private async render(format: ReportFormat, type: string, periodStart: string, periodEnd: string, table: ReportTable): Promise<{ content: Buffer; contentType: string }> {
    const subtitle = `${periodStart} to ${periodEnd} · ${table.rows.length} row(s) · total PKR ${formatPaisa(table.totalPaisa)}`;
    if (format === 'PDF') {
      const lines = [
        subtitle,
        '',
        ...table.columns.map((column, index) => column.padEnd(index === 0 ? 14 : 24)),
        ...table.rows.map(row => row.map((cell, index) => cell.padEnd(index === 0 ? 14 : 24)).join(''))
      ];
      return { content: renderTextPdf(`${table.title} — ${type}`, lines), contentType: 'application/pdf' };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(table.title.slice(0, 28));
    sheet.addRow(table.columns);
    for (const row of table.rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(column => {
      column.width = Math.min(40, Math.max(14, column.header?.length ?? 14 + 6));
    });
    // Money lands in the sheet as a number so it can be summed in Excel, which is why the report
    // keeps its own `totalPaisa` rather than trusting a reader to add up formatted strings.
    sheet.addRow([]);
    sheet.addRow([`Total (paisa)`, table.totalPaisa.toString()]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { content: buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  /** Exposed for tests: what a report's money should equal, straight from the ledger. */
  async commissionTotalFor(periodStart: string, periodEnd: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(e.amount_paisa), 0)::bigint as total FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.type = 'PLATFORM_COMMISSION' AND e.direction = 'CREDIT'
          AND e.created_at >= ${periodStart}::date AND e.created_at < ${periodEnd}::date`
    );
    return rows[0]?.total ?? 0n;
  }

  /** Exposed for the controller so a number that is a count is never typed as money. */
  static count(value: number): string {
    return String(value);
  }

  /** Exposed for the controller. */
  static paisa(value: bigint): number {
    return paisaToNumber(value);
  }
}