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

export type FinanceLedgerEntry = {
  entryId: number;
  transactionId: string;
  type: string;
  direction: "DEBIT" | "CREDIT";
  amountPaisa: number;
  account: string;
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
};
