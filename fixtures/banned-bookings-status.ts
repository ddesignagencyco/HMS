/**
 * Intentionally invalid. `no-restricted-syntax` must reject this file, which is
 * what the lint-fixtures test asserts. The shapes below are the ones real code
 * uses, including the qualified `prisma.booking.update` handle and the nested
 * `data` object, because a ban that only catches one of them can be sidestepped.
 * Never import or build this module.
 */
declare const prisma: { booking: { update: (args: unknown) => Promise<void> } };
declare const update: (args: unknown) => Promise<void>;
declare const sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
declare const db: { $executeRaw: (query: unknown) => Promise<unknown> };

export const bareStatusWrite = async (): Promise<void> => {
  await update({ status: 'VERIFIED' });
};

export const prismaStatusWrite = async (): Promise<void> => {
  await prisma.booking.update({ where: { id: '1' }, data: { status: 'VERIFIED' } });
};

export const bareNestedStatusWrite = async (): Promise<void> => {
  await update({ where: { id: '1' }, data: { status: 'CANCELLED_CUSTOMER' } });
};

/**
 * The raw-SQL shape the object-literal selectors cannot reach: `status` is a
 * word inside a TemplateElement, not a Property node. Every real status write
 * in the codebase looks like this, so a ban that only matched Prisma's
 * `.update()` never fired at all.
 */
export const rawStatusWrite = async (to: string): Promise<void> => {
  await db.$executeRaw(sql`UPDATE bookings SET status = ${to}::booking_status WHERE id = '1'`);
};
