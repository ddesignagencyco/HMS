/**
 * The counterpart to the banned fixtures: the shapes that must stay legal, so a
 * test can prove the rules are not simply failing on everything.
 */
export const readStatusAsText = (status: string): string => status.toUpperCase();

export const sumPaisa = (amount: bigint, fee: bigint): bigint => amount + fee;

export const countRows = (rows: number): number => Number(rows);

// A Number() on a member that is not money, and raw SQL that does not touch
// bookings.status — both must stay green.
declare const sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const db: { $queryRaw: (query: unknown) => Promise<unknown> };
export const readWindowMinutes = (config: { windowMinutes: number }): number => Number(config.windowMinutes);

export const readBookingRow = (id: string): Promise<unknown> => db.$queryRaw(sql`SELECT status FROM bookings WHERE id = ${id}`);
