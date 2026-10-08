/**
 * Intentionally invalid. `no-restricted-syntax` must reject this file, which is
 * what the lint-fixtures test asserts. Never import or build this module.
 */
export const asNumber = (amount: bigint): number => Number(amount);

export const totalBalanceAsNumber = (balance: bigint): number => Number(balance);

export const commissionAsNumber = (commission: bigint): number => Number(commission);

export const perMonthFeeAsNumber = (fee: bigint): number => Number(fee);

/**
 * Real code coerces money that lives on a member (`raw.approvedTotalPaisa`),
 * not a bare identifier — `Number(member)` is a MemberExpression argument and
 * the Identifier selector could not see it, so the whole ban only ever fired
 * on the fixtures, never on the codebase.
 */
type RawRow = { pricePaisa: bigint; approvedTotalPaisa: bigint };
export const memberAmountsAsNumber = (raw: RawRow): number[] => [Number(raw.pricePaisa), Number(raw.approvedTotalPaisa)];
