import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type FinanceRefund = {
  id: string;
  bookingCode: string;
  bookingId?: string;
  amountPaisa: number;
  reasonCode: string;
  reasonText?: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  gateway?: string;
  createdAt: string;
};

export type FinancePayout = {
  id: string;
  providerId: string;
  providerName?: string;
  amountPaisa: number;
  status: "REQUESTED" | "APPROVED" | "IN_BATCH" | "PAID" | "FAILED";
  accountLast4?: string;
  failureReason?: string | null;
  createdAt: string;
};

export type FinanceCashReconciliationRow = {
  providerId: string;
  providerName?: string;
  awaitingConfirmationJobs: number;
  awaitingConfirmationPaisa: number;
  settledJobs: number;
  collectedPaisa: number;
  commissionPaisa: number;
  walletBalancePaisa?: number;
};

export type FinanceDebtRow = {
  providerId: string;
  providerName?: string;
  debtPaisa: number;
  ceilingPaisa?: number;
  isBlocked?: boolean;
  offersBlocked?: boolean;
  offerBlockedReason?: string | null;
  since?: string;
  createdAt?: string;
};

/**
 * One row of `GET /finance/ledger`.
 *
 * This is a **flat ledger entry, not a transaction.** The API joins
 * `ledger_entries` and returns one row per entry, carrying that entry's single
 * `account` and `direction` (`finance.service.ts:105-117`). It does not return
 * the double-entry line pairs of the parent transaction, so a screen cannot
 * check that debits equal credits from this response — only the server knows
 * that, because the constraint lives in the database.
 */
export type FinanceLedgerEntry = {
  entryId: number;
  transactionId: string;
  type: string;
  memo: string | null;
  bookingCode: string | null;
  account: string;
  ownerId: string | null;
  direction: "DEBIT" | "CREDIT";
  amountPaisa: number;
  createdAt: string;
};

export type FinanceEscrowItem = {
  bookingId: string;
  code?: string;
  bookingCode?: string;
  status: string;
  paymentMode?: string;
  providerId?: string | null;
  heldPaisa: number;
  finalPaisa?: number | null;
  serviceName?: string;
  providerName?: string;
  createdAt?: string;
};

export type LedgerQueryParams = {
  accountType?: string;
  ownerId?: string;
  bookingId?: string;
  before?: number;
  limit?: number;
};

/* ---- reports (`GET|POST /finance/reports`) --------------------------- */

/**
 * `reports.controller.ts` narrows the whole surface to these four, and
 * `reportRequestSchema` refuses anything else — so these are a closed set, not
 * a list the screen may extend.
 */
export const REPORT_TYPES = ['MONTHLY', 'REVENUE', 'PROVIDER_PERFORMANCE', 'VERIFICATION'] as const;
export const REPORT_FORMATS = ['PDF', 'XLSX'] as const;

export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * One row of `GET /finance/reports`, or of `GET /finance/reports/{id}` — the
 * service returns the identical `ReportRunView` from both.
 *
 * **`totalPaisa` is a string, not a number.** `reports.service.ts:127` calls
 * `.toString()` on a `bigint` before returning it, because int8 does not survive
 * JSON as a number. Reading it as a figure without going through
 * `paisaToNumber` first would be a type error at best and a wrong total at worst.
 * `null` until the run finishes — a QUEUED run has no total yet, which is a real
 * absence rather than a zero.
 */
export type FinanceReportRun = {
  id: string;
  type: ReportType;
  /** Inclusive start, `YYYY-MM-DD`. */
  periodStart: string;
  /** Exclusive end, `YYYY-MM-DD`. Adjacent periods tile without a gap or an overlap. */
  periodEnd: string;
  format: ReportFormat;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  rowCount: number | null;
  totalPaisa: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Non-null only once `status` is `DONE`. Same-origin path, so a plain link. */
  downloadUrl: string | null;
};

export type ReportRequestInput = {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  format: ReportFormat;
};

/* ---- payout batches (`/finance/payout-batches`) ---------------------- */

/**
 * One row of `GET /finance/payout-batches`.
 *
 * `totalPaisa` is already `paisaToNumber`'d server-side (`payouts.service.ts:231`),
 * so unlike a report's total this one is a plain integer.
 *
 * `periodStart`/`periodEnd` come back as `Date`, which serialises to an ISO
 * string — but the two describe a *calendar window*, so the screen must date-format
 * them rather than assume a timestamp.
 */
export type FinancePayoutBatch = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: 'EXPORTED' | 'PAID' | 'PARTIALLY_FAILED';
  totalPaisa: number;
  payoutCount: number;
  createdAt: string;
  paidAt: string | null;
};

/** `POST /finance/payout-batches` — 201 with this shape, or 409 if nothing is waiting. */
export type FinancePayoutBatchCreated = {
  id: string;
  status: 'EXPORTED';
  payouts: number;
  totalPaisa: number;
  fileKey: string;
};

/**
 * `POST /finance/payout-batches/{id}/mark-paid`.
 *
 * `status` is computed by the server from what is left in the batch, so the
 * screen must never predict it: a batch with a failure in it comes back
 * `PARTIALLY_FAILED`, not `FAILED`.
 */
export type FinancePayoutBatchSettled = {
  id: string;
  status: 'EXPORTED' | 'PAID' | 'PARTIALLY_FAILED';
  paid: number;
  failed: number;
};

/** One payout result. `failureReason` is only read when `status` is `FAILED`. */
export type FinancePayoutResult = {
  payoutId: string;
  status: 'PAID' | 'FAILED';
  failureReason?: string;
};

/** `POST /finance/reconciliation/run` — 7 checks against the ledger. */
export type FinanceReconciliationReport = {
  ranAt: string;
  /** How many checks ran. Always 7 today; not the number of passes. */
  checks: number;
  /** Empty means the books balanced. One entry is one mismatch worth a person looking. */
  drift: { check: string; subject: string; expected: string; actual: string }[];
};

export const financeApi = {
  refunds: (status?: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinanceRefund[] }>("/finance/refunds", {
      method: "GET",
      query: status ? { status } : undefined,
      signal: options?.signal,
      locale: options?.locale,
    }),

  createRefund: (
    input: { bookingId: string; amountPaisa: number; reasonCode: string; reasonText?: string },
    options?: { locale?: Locale }
  ) =>
    apiRequest<{ refundIds: string[] }>("/finance/refunds", {
      method: "POST",
      body: input,
      locale: options?.locale,
    }),

  payouts: (status?: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinancePayout[] }>("/finance/payouts", {
      method: "GET",
      query: status ? { status } : undefined,
      signal: options?.signal,
      locale: options?.locale,
    }),

  approvePayout: (id: string, options?: { locale?: Locale }) =>
    apiRequest<{ id: string; status: string }>(`/finance/payouts/${id}/approve`, {
      method: "POST",
      locale: options?.locale,
    }),

  cashReconciliation: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinanceCashReconciliationRow[] }>("/finance/cash-reconciliation", {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  debts: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ totalDebtPaisa: number; items: FinanceDebtRow[] }>("/finance/debts", {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  ledger: (params?: LedgerQueryParams, options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinanceLedgerEntry[]; nextBefore: number | null }>("/finance/ledger", {
      method: "GET",
      query: params as Record<string, string | number | boolean | undefined>,
      signal: options?.signal,
      locale: options?.locale,
    }),

  escrow: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ totalHeldPaisa: number; items: FinanceEscrowItem[] }>("/finance/escrow", {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  /* ---- reports --------------------------------------------------------
   * `PolicyDecorator({ roles: ['FINANCE', 'ADMIN'], totpRequired: true })` on all
   * four. The admin surface therefore reads them too, which is why the reports
   * screen hangs off `/admin/reports` and not off `/finance`.
   *
   * **Asking for the same report twice while one is open returns the open one**
   * (`reports.service.ts:78`) rather than starting a second copy of the same
   * numbers, so a double-clicked "Request" is not a duplicate charge on the
   * queue — but the screen must still disable the button while it is in flight,
   * or the operator gets a run they did not mean to create. */

  /** Your own report runs, newest first. Capped at 50 by the server. */
  reports: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinanceReportRun[] }>("/finance/reports", {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  /**
   * Queues a run and returns it immediately — these are too slow to build inside
   * a request. Poll `report(id)` or wait for the `report.ready` notification.
   *
   * 409 if that period is already building, which `request` returns as the
   * existing run instead, so a conflict here means something else went wrong.
   */
  requestReport: (input: ReportRequestInput, options?: { locale?: Locale }) =>
    apiRequest<FinanceReportRun>("/finance/reports", { method: "POST", body: { ...input }, locale: options?.locale }),

  /**
   * One run's status. **This is the polling endpoint**, so it is deliberately
   * cheap: it is the only call a screen makes on a timer.
   *
   * 409 on `/download` while a run is still building, so the status is the thing
   * to check — not whether the button appears to be broken.
   */
  report: (id: string, options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<FinanceReportRun>(`/finance/reports/${encodeURIComponent(id)}`, {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  /**
   * FR-PY-05: gathers every approved payout not yet in a batch into one bank
   * file. **409 if nothing is waiting** — which is the normal answer on a day
   * with no approvals, and must read as "nothing to batch", not as a failure.
   */
  payoutBatches: (options?: { locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<{ items: FinancePayoutBatch[] }>("/finance/payout-batches", {
      method: "GET",
      signal: options?.signal,
      locale: options?.locale,
    }),

  /** 201 with the new batch, or 409 "There are no approved payouts waiting for a batch". */
  createPayoutBatch: (
    input: { periodStart: string; periodEnd: string },
    options?: { locale?: Locale }
  ) => apiRequest<FinancePayoutBatchCreated>("/finance/payout-batches", { method: "POST", body: { ...input }, locale: options?.locale }),

  /**
   * Settles a batch against the bank's answer.
   *
   * **Leave `results` off to mark every payout in the batch paid.** Sending an
   * empty array is *not* the same thing — `markSchema` requires `.min(1)` when
   * `results` is present at all, so `results: []` is a 422. A payout named here
   * that is not in the batch is a 400, and a payout already settled is skipped,
   * so repeating the call is safe.
   */
  markPayoutBatchPaid: (
    id: string,
    results?: FinancePayoutResult[],
    options?: { locale?: Locale }
  ) =>
    apiRequest<FinancePayoutBatchSettled>(`/finance/payout-batches/${encodeURIComponent(id)}/mark-paid`, {
      method: "POST",
      ...(results === undefined ? {} : { body: { results } }),
      locale: options?.locale,
    }),

  /**
   * FR-PY-06: proves the books still add up — derived balances against their
   * entries, every transaction balancing, the gateway against the ledger, and
   * each booking's escrow against its own movements.
   *
   * A **mutation, not a read**: it writes to the audit log and raises an event
   * per drift, so it is never retried and never polled.
   */
  runReconciliation: (options?: { locale?: Locale }) =>
    apiRequest<FinanceReconciliationReport>("/finance/reconciliation/run", { method: "POST", locale: options?.locale }),
};

/* ---- protected file routes -------------------------------------------
 * These return binary, so they are not in `financeApi`: `apiRequest` parses a
 * response as JSON and would hand a screen the first bytes of a spreadsheet.
 * They are paths for `downloadFile` (`lib/api/download.ts`), kept next to the
 * reads they belong to so the two cannot drift apart. */

/** The built report. 409 while it is still building — check the run's status, not this. */
export const reportDownloadPath = (id: string): string => `/finance/reports/${encodeURIComponent(id)}/download`;

/** The bank file, with full account numbers. Every download is audited. */
export const payoutBatchCsvPath = (id: string): string => `/finance/payout-batches/${encodeURIComponent(id)}/export.csv`;

/** One provider's statement for one batch, as a PDF. 404 if they had none in it. */
export const payoutStatementPath = (batchId: string, providerId: string): string =>
  `/finance/payout-batches/${encodeURIComponent(batchId)}/statements/${encodeURIComponent(providerId)}`;
