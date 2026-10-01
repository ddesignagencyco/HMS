// apps/api/src/payment/ledger.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type AccountType =
  | 'GATEWAY_CLEARING'
  | 'ESCROW'
  | 'PROVIDER_WALLET'
  | 'PLATFORM_COMMISSION'
  | 'PENALTY_INCOME'
  | 'CUSTOMER_COMPENSATION'
  | 'PROMO_EXPENSE'
  | 'CUSTOMER_RECEIVABLE'
  | 'PLAN_DEFERRED'
  | 'PAYOUT_CLEARING';

export type LedgerTxType = 'CAPTURE' | 'RELEASE' | 'REFUND' | 'COMMISSION' | 'CASH_SETTLEMENT' | 'CANCEL_FEE' | 'PENALTY' | 'PAYOUT' | 'PAYOUT_CONFIRM' | 'DEBT_PAYMENT' | 'PLAN_PURCHASE' | 'PLAN_RELEASE' | 'ADJUSTMENT' | 'REVERSAL';

/** `owner`/`booking` are the dimensions that make an account unique per (type, owner, booking); leave out what the account type does not use. */
export type LedgerLine = { account: AccountType; direction: 'DEBIT' | 'CREDIT'; amountPaisa: bigint; ownerUserId?: string; bookingId?: string };

export type LedgerPosting = { type: LedgerTxType; bookingId?: string; idempotencyKey: string; memo?: string; createdBy?: string | null; reversesTransactionId?: string | null; lines: readonly LedgerLine[] };

/**
 * Double-entry postings (TRD §6). Every posting is idempotent on its key: a
 * replayed webhook or a retried job posts nothing the second time, which is
 * what makes "one capture, one ledger transaction" hold under retries. The
 * database independently refuses an unbalanced transaction at commit
 * (`ledger_entries_balanced`), so this only checks the cheap things up front.
 */
@Injectable()
export class LedgerService {
  /** Returns the ledger transaction id, or `null` when this key was already posted (nothing was written). */
  async post(tx: Prisma.TransactionClient, posting: LedgerPosting): Promise<string | null> {
    const debit = posting.lines.filter(line => line.direction === 'DEBIT').reduce((sum, line) => sum + line.amountPaisa, 0n);
    const credit = posting.lines.filter(line => line.direction === 'CREDIT').reduce((sum, line) => sum + line.amountPaisa, 0n);
    if (posting.lines.length < 2 || debit !== credit) throw new Error(`Unbalanced ledger posting ${posting.idempotencyKey}: debit ${debit} credit ${credit}`);
    if (posting.lines.some(line => line.amountPaisa <= 0n)) throw new Error(`Ledger posting ${posting.idempotencyKey} has a non-positive line`);

    const inserted = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO ledger_transactions(type, booking_id, idempotency_key, memo, created_by, reverses_transaction_id)
        VALUES (${posting.type}::ledger_tx_type, ${posting.bookingId ?? null}::uuid, ${posting.idempotencyKey}, ${posting.memo ?? null}, ${posting.createdBy ?? null}::uuid, ${posting.reversesTransactionId ?? null}::uuid)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`
    );
    const transactionId = inserted[0]?.id;
    if (transactionId === undefined) return null;

    for (const line of posting.lines) {
      const accountId = await this.account(tx, line);
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_paisa) VALUES (${transactionId}::uuid, ${accountId}::uuid, ${line.direction}::entry_direction, ${line.amountPaisa})`
      );
    }
    return transactionId;
  }

  private async account(tx: Prisma.TransactionClient, line: LedgerLine): Promise<string> {
    // The uniqueness is NULLS NOT DISTINCT, so the same (type, owner, booking) always lands on one row. DO NOTHING (then read) rather
    // than DO UPDATE: an update would row-lock the shared GATEWAY_CLEARING account for the whole transaction on every posting.
    const inserted = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO ledger_accounts(type, owner_user_id, booking_id) VALUES (${line.account}::account_type, ${line.ownerUserId ?? null}::uuid, ${line.bookingId ?? null}::uuid)
        ON CONFLICT ON CONSTRAINT ledger_accounts_uniq DO NOTHING RETURNING id`
    );
    const rows =
      inserted.length > 0
        ? inserted
        : await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM ledger_accounts WHERE type = ${line.account}::account_type AND owner_user_id IS NOT DISTINCT FROM ${line.ownerUserId ?? null}::uuid
              AND booking_id IS NOT DISTINCT FROM ${line.bookingId ?? null}::uuid AND subscription_id IS NULL`
          );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Ledger account upsert returned no row');
    return id;
  }
}
