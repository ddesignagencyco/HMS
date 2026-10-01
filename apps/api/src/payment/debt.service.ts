// apps/api/src/payment/debt.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { SettingsService } from '../platform/settings.service.js';

export type Wallet = { balancePaisa: bigint; debtPaisa: bigint; ceilingPaisa: bigint; blocked: boolean; offerBlockedReason: string | null };

/**
 * FR-PY-05 / FR-PY-13 / TRD §6.4: a provider's wallet is what the platform owes them. On a cash job the customer pays the provider
 * directly and the provider owes the platform its commission, so the wallet can go negative — that is commission debt. Debt over
 * `cash.debt_ceiling_paisa` stops new offers (`providers.offer_blocked_reason = 'DEBT'`) until it is paid down. The block is recomputed
 * from the ledger every time the wallet moves, so it can never disagree with the money.
 */
@Injectable()
export class DebtService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  async walletBalance(client: Prisma.TransactionClient | PrismaService, providerId: string): Promise<bigint> {
    const rows = await client.$queryRaw<{ balance: bigint }[]>(
      Prisma.sql`SELECT coalesce(sum(b.balance), 0)::bigint as balance FROM ledger_accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.type = 'PROVIDER_WALLET' AND a.owner_user_id = ${providerId}::uuid`
    );
    return rows[0]?.balance ?? 0n;
  }

  async wallet(client: Prisma.TransactionClient | PrismaService, providerId: string): Promise<Wallet> {
    const balance = await this.walletBalance(client, providerId);
    const ceiling = BigInt(await this.settings.getNumber('cash.debt_ceiling_paisa'));
    const reasons = await client.$queryRaw<{ reason: string | null }[]>(Prisma.sql`SELECT offer_blocked_reason as reason FROM providers WHERE user_id = ${providerId}::uuid`);
    const debt = balance < 0n ? -balance : 0n;
    return { balancePaisa: balance, debtPaisa: debt, ceilingPaisa: ceiling, blocked: debt > ceiling, offerBlockedReason: reasons[0]?.reason ?? null };
  }

  /**
   * Sets or clears the DEBT block to match the wallet right now. Only touches the DEBT reason: a provider blocked for another reason
   * (suspension) stays blocked. Call it inside the transaction that moved the wallet.
   */
  async refreshBlock(tx: Prisma.TransactionClient, providerId: string): Promise<void> {
    const wallet = await this.wallet(tx, providerId);
    if (wallet.debtPaisa > wallet.ceilingPaisa) {
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET offer_blocked_reason = 'DEBT' WHERE user_id = ${providerId}::uuid AND offer_blocked_reason IS NULL`);
    } else {
      await tx.$executeRaw(Prisma.sql`UPDATE providers SET offer_blocked_reason = NULL WHERE user_id = ${providerId}::uuid AND offer_blocked_reason = 'DEBT'`);
    }
  }
}
