// apps/api/src/common/paging.ts
import { applyDecorators } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest } from './domain-error.js';
import { ApiQueryField } from './swagger.js';

/**
 * BE-007 (§3.2): one paging convention for every list that used to be cut at a hard SQL LIMIT.
 *
 * - Tables:  `?page=1&limit=20` (limit 1-100) -> `{ items, pagination: { total, page, limit, hasMore }, truncated }`.
 * - Streams (append-only: notifications, audit, ledger): `?limit=50&before=<cursor>` -> `{ items, nextCursor }`.
 *
 * Backward compatibility: these endpoints already answered `{ items }` and existing clients read that, so
 * the envelope only ever ADDS fields. A request that sends neither `page` nor `limit` keeps the old window
 * (the old cut-off, or the whole list where there never was one) rather than silently shrinking to 20 rows,
 * but now says so: `pagination.total` is the real count and `truncated` is true when rows were left out.
 * Sending `page` and/or `limit` opts in to the documented 20-row default.
 */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Zod fields to spread into a list endpoint's query schema. `maxLimit` is only raised where an older contract already allowed more. */
export const pageFields = (maxLimit: number = MAX_PAGE_LIMIT) => ({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(maxLimit).optional()
});

export type PageQuery = { page?: number | undefined; limit?: number | undefined };

export type PageWindow = { page: number; /** null = no LIMIT (a list that was never capped). */ limit: number | null; offset: number };

/** `legacyLimit` is what the endpoint returned before paging existed (null = everything). */
export const pageWindow = (query: PageQuery, legacyLimit: number | null): PageWindow => {
  if (query.page === undefined && query.limit === undefined) return { page: 1, limit: legacyLimit, offset: 0 };
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const page = query.page ?? 1;
  return { page, limit, offset: (page - 1) * limit };
};

/** `LIMIT .. OFFSET ..` for a window. A null limit is Postgres `LIMIT NULL`, i.e. no limit. */
export const limitClause = (window: PageWindow): Prisma.Sql => Prisma.sql`LIMIT ${window.limit}::bigint OFFSET ${window.offset}::bigint`;

export type Pagination = { total: number; page: number; limit: number; hasMore: boolean };
export type Paged<T> = { items: T[]; pagination: Pagination; truncated: boolean };

export const pagination = (window: PageWindow, total: number): Pagination => {
  const limit = window.limit ?? Math.max(total, 1);
  return { total, page: window.page, limit, hasMore: window.offset + limit < total };
};

export const paged = <T>(items: T[], total: number, window: PageWindow): Paged<T> => {
  const info = pagination(window, total);
  return { items, pagination: info, truncated: info.hasMore };
};

/** Runs a `SELECT count(*)::bigint as n ...` and narrows it. The count shares its FROM/WHERE with the page query so they cannot disagree. */
export const countOf = async (client: { $queryRaw<T = unknown>(query: Prisma.Sql): Prisma.PrismaPromise<T> }, query: Prisma.Sql): Promise<number> => {
  const rows = await client.$queryRaw<{ n: bigint }[]>(query);
  return Number(rows[0]?.n ?? 0n);
};

// --------------------------------------------------------------------- streams

export const cursorFields = (maxLimit: number) => ({
  limit: z.coerce.number().int().min(1).max(maxLimit).optional(),
  before: z.string().trim().min(1).max(200).optional()
});

/** One extra row is fetched so "is there more" is known without a count; the extra row is dropped here. */
export const cursorPage = <T>(rows: T[], limit: number, cursorOf: (row: T) => string): { items: T[]; nextCursor: string | null } => {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
};

/** A cursor is opaque to clients; (timestamp, id) streams encode both so rows sharing a timestamp are neither skipped nor repeated. */
export const encodeCursor = (...parts: string[]): string => Buffer.from(parts.join('|'), 'utf8').toString('base64url');

export const decodeCursor = (cursor: string, parts: number): string[] => {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (decoded.length !== parts || decoded.some(part => part.length === 0)) throw badRequest('That cursor is not valid');
  return decoded;
};

/** A numeric-id cursor (audit, ledger): the id of the last row seen, as a string. */
export const decodeIdCursor = (cursor: string): bigint => {
  if (!/^\d{1,18}$/.test(cursor)) throw badRequest('That cursor is not valid');
  return BigInt(cursor);
};

export const ApiPageQuery = (maxLimit: number = MAX_PAGE_LIMIT): MethodDecorator =>
  applyDecorators(
    ApiQueryField('page', { type: 'number', description: 'Page number, from 1. Sending page or limit opts in to the paged window (default 20 per page); omitting both keeps the endpoint’s original window and `pagination.total` / `truncated` say whether rows were left out.' }),
    ApiQueryField('limit', { type: 'number', description: `Rows per page, 1–${maxLimit}, default 20 once paging is used.` })
  );

export const ApiCursorQuery = (maxLimit: number, defaultLimit: number): MethodDecorator =>
  applyDecorators(
    ApiQueryField('limit', { type: 'number', description: `Rows per request, 1–${maxLimit}, default ${defaultLimit}.` }),
    ApiQueryField('before', { description: 'The `nextCursor` of the previous response; returns the rows older than it. Omit for the newest.' })
  );

/** For endpoints whose only query parameters are the paging ones. */
export const pageQuerySchema = z.object(pageFields()).strict();
