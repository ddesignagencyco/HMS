// apps/api/test/integration/provider-documents.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProviderDocumentsService } from '../../src/provider/provider-documents.service.js';
import { SEEDED_STAFF, adminSession, callApi, createTestApp, postJson, registerAndVerify, staffSession, type TestUser } from './harness.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let admin: { accessToken: string; userId: string };
let agent: { accessToken: string; userId: string };
let finance: { accessToken: string; userId: string };

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  admin = await adminSession(app);
  agent = await staffSession(app, SEEDED_STAFF.agent1);
  finance = await staffSession(app, SEEDED_STAFF.finance);
});

afterAll(async () => {
  await close();
});

const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });

/** A one-pixel PNG, so the body is a real image rather than arbitrary bytes. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * `cnic_hash` carries a UNIQUE constraint, so a CNIC can only ever be registered
 * once across the whole database. Hard-coding one would make this file pass on a
 * freshly reset database and fail on every re-run against the same one, so each
 * call mints a CNIC no other test — or earlier run — has used.
 */
let cnicSequence = 0;
const uniqueCnic = (): string => {
  cnicSequence += 1;
  const middle = `${cnicSequence}${Math.floor(Math.random() * 900_000)}`.padStart(7, '0').slice(0, 7);
  return `35202-${middle}-${(cnicSequence % 9) + 1}`;
};

/** The same CNIC as `uniqueCnic` produced, written the way a provider might type it. */
const spacedForm = (cnic: string): string => cnic.replace('-', ' ');
const bareForm = (cnic: string): string => cnic.replace(/-/g, '');

const submitDocument = (provider: TestUser, body: Record<string, unknown>) =>
  callApi<{ id: string; docType: string; status: string; storageKey: string }>(app, '/provider/documents', bearer(provider.accessToken, postJson(body)));

type DocumentRow = { id: string; providerId: string; status: string; storageKey: string; docType: string; reviewedBy: string | null; reviewNote: string | null };

const auditRowsFor = async (entityId: string): Promise<{ action: string; actorUserId: string | null; actorRole: string; entityId: string }[]> => {
  const prisma = app.get(PrismaService);
  return prisma.$queryRaw<{ action: string; actorUserId: string | null; actorRole: string; entityId: string }[]>(
    Prisma.sql`SELECT action, actor_user_id as "actorUserId", actor_role as "actorRole", entity_id as "entityId" FROM audit_log WHERE entity_type = 'provider_document' AND entity_id = ${entityId} ORDER BY created_at, id`
  );
};

describe('FR-SP-06: a provider uploads their identity documents', () => {
  it('records a CNIC front, a CNIC back and a trade certificate, all pending review', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const front = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() });
    expect(front.status).toBe(201);
    expect(front.body.docType).toBe('CNIC_FRONT');
    expect(front.body.status).toBe('PENDING');

    const back = await submitDocument(provider, { docType: 'CNIC_BACK', contentType: 'image/png', contentBase64: PNG_BASE64 });
    expect(back.status).toBe(201);

    const certificate = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 trade certificate').toString('base64') });
    expect(certificate.status).toBe(201);

    const listed = await callApi<{ items: DocumentRow[]; cnic: { hasCnic: boolean; cnicVerified: boolean } }>(app, '/provider/documents', bearer(provider.accessToken));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(3);
    expect(listed.body.cnic).toEqual({ hasCnic: true, cnicVerified: false });
  });

  it('never returns the CNIC digits through any endpoint', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const cnic = uniqueCnic();
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });
    expect(submitted.status).toBe(201);

    const mine = await callApi(app, '/provider/documents', bearer(provider.accessToken));
    const theirs = await callApi(app, `/admin/providers/${provider.id}/documents`, bearer(admin.accessToken));
    for (const response of [mine, theirs]) {
      expect(JSON.stringify(response.body)).not.toContain(cnic);
      expect(JSON.stringify(response.body)).not.toContain(bareForm(cnic));
    }
  });

  it('stores the CNIC encrypted, so the digits are not readable in the providers row', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const cnic = uniqueCnic();
    const digits = bareForm(cnic);
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });

    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ cnicEnc: Buffer | null; cnicHash: string | null }[]>(Prisma.sql`SELECT cnic_enc as "cnicEnc", cnic_hash as "cnicHash" FROM providers WHERE user_id = ${provider.id}::uuid`);
    const stored = rows[0];
    expect(stored?.cnicEnc).not.toBeNull();
    // The ciphertext is not the plaintext, and neither is it the raw digits in any encoding.
    expect(stored?.cnicEnc?.toString('utf8')).not.toContain(digits);
    expect(stored?.cnicEnc?.toString('hex')).not.toContain(Buffer.from(digits).toString('hex'));
    // What is stored alongside it is a keyed hash, not the CNIC.
    expect(stored?.cnicHash).not.toContain('35202');
    expect(stored?.cnicHash).toMatch(/^[0-9a-f]{64}$/);

    // ...and it really does decrypt back to what was submitted.
    expect(await app.get(ProviderDocumentsService).readCnicForVerification(provider.id)).toBe(digits);
  });

  it('refuses a CNIC that is not 13 digits, with a field error', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: '12345' });
    expect(response.status).toBe(422);
    const body = response.body as unknown as { code: string; errors: { path: string }[] };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors.map(error => error.path)).toContain('cnicNumber');
  });

  it('refuses a cnicNumber attached to something that is not a CNIC document', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64, cnicNumber: '35202-4444444-4' });
    expect(response.status).toBe(422);
  });

  it('refuses a content type that is not an image or a PDF', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/octet-stream', contentBase64: PNG_BASE64 });
    expect(response.status).toBe(422);
  });

  it('requires either the bytes or a presigned key, never neither and never both', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    expect((await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf' })).status).toBe(422);
    expect(
      (await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64, storageKey: 'someone/else/key' })).status
    ).toBe(422);
  });

  it('lets a provider re-upload a rejected document rather than being locked to one row', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const first = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    const rejected = await callApi<{ status: string }>(
      app,
      `/admin/documents/${first.body.id}/review`,
      bearer(admin.accessToken, postJson({ status: 'REJECTED', note: 'The certificate is cut off at the bottom' }))
    );
    expect(rejected.body.status).toBe('REJECTED');

    const second = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
  });

  it('keeps one provider out of another provider’s documents', async () => {
    const mine = await registerAndVerify(app, 'PROVIDER');
    const theirs = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(theirs, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });

    const listed = await callApi<{ items: DocumentRow[] }>(app, '/provider/documents', bearer(mine.accessToken));
    expect(listed.body.items).toHaveLength(0);
  });
});

describe('SHM-022: duplicate CNIC rejection', () => {
  it('returns 409 when a second account registers the same CNIC', async () => {
    const cnic = uniqueCnic();
    const first = await registerAndVerify(app, 'PROVIDER');
    const original = await submitDocument(first, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });
    expect(original.status).toBe(201);

    const second = await registerAndVerify(app, 'PROVIDER');
    const clash = await submitDocument(second, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });
    expect(clash.status).toBe(409);
    expect((clash.body as unknown as { code: string }).code).toBe('CONFLICT');
  });

  it('catches the clash however the CNIC was written — dashes and spaces normalise to one index', async () => {
    const cnic = uniqueCnic();
    const first = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(first, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });

    const second = await registerAndVerify(app, 'PROVIDER');
    expect((await submitDocument(second, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: spacedForm(cnic) })).status).toBe(409);
    expect((await submitDocument(second, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: bareForm(cnic) })).status).toBe(409);
  });

  it('lets the same provider record their own CNIC again, since the index enforces one account per CNIC, not one row per CNIC', async () => {
    // A provider who uploaded only the front scan can add the back and repeat the
    // number. Refusing that would punish them for completing their own paperwork;
    // what must never happen is a *different* person claiming the same CNIC.
    const provider = await registerAndVerify(app, 'PROVIDER');
    const cnic = uniqueCnic();
    expect((await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic })).status).toBe(201);
    expect((await submitDocument(provider, { docType: 'CNIC_BACK', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic })).status).toBe(201);
    expect(await app.get(ProviderDocumentsService).readCnicForVerification(provider.id)).toBe(bareForm(cnic));
  });

  it('leaves the second provider with no CNIC recorded, so a rejected write leaves no partial state', async () => {
    const cnic = uniqueCnic();
    const first = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(first, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });

    const second = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(second, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: cnic });

    expect(await app.get(ProviderDocumentsService).readCnicForVerification(second.id)).toBeNull();
    const listed = await callApi<{ cnic: { hasCnic: boolean } }>(app, '/provider/documents', bearer(second.accessToken));
    expect(listed.body.cnic.hasCnic).toBe(false);
  });

  it('allows a different CNIC on a second account', async () => {
    const first = await registerAndVerify(app, 'PROVIDER');
    const second = await registerAndVerify(app, 'PROVIDER');
    expect((await submitDocument(first, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() })).status).toBe(201);
    expect((await submitDocument(second, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() })).status).toBe(201);
  });
});

describe('SHM-022: agent and finance get 403 on document access', () => {
  it('rejects an agent listing a provider’s documents', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    const response = await callApi<{ code: string }>(app, `/admin/providers/${provider.id}/documents`, bearer(agent.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects finance listing a provider’s documents', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    const response = await callApi<{ code: string }>(app, `/admin/providers/${provider.id}/documents`, bearer(finance.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects an agent fetching a signed link to a document', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    const response = await callApi<{ code: string }>(app, `/admin/documents/${submitted.body.id}/url`, bearer(agent.accessToken));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects finance fetching a signed link to a document', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    expect((await callApi(app, `/admin/documents/${submitted.body.id}/url`, bearer(finance.accessToken))).status).toBe(403);
  });

  it('rejects an agent reviewing a document', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    const response = await callApi<{ code: string }>(app, `/admin/documents/${submitted.body.id}/review`, bearer(agent.accessToken, postJson({ status: 'VERIFIED' })));
    expect(response.status).toBe(403);
  });

  it('rejects a provider reaching the admin routes', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    expect((await callApi(app, `/admin/providers/${provider.id}/documents`, bearer(provider.accessToken))).status).toBe(403);
  });

  it('rejects a customer reaching the admin routes', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    const provider = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    expect((await callApi(app, `/admin/providers/${provider.id}/documents`, bearer(customer.accessToken))).status).toBe(403);
  });

  it('lets an admin in, so the restriction is a role rule rather than the route being broken', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    expect((await callApi(app, `/admin/providers/${provider.id}/documents`, bearer(admin.accessToken))).status).toBe(200);
  });
});

describe('SHM-022: every document view is audited', () => {
  it('writes an audit row naming the admin who asked, each time', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() });

    expect((await auditRowsFor(submitted.body.id)).filter(row => row.action === 'provider_document.view')).toHaveLength(0);

    const first = await callApi<{ url: string; expiresAt: string }>(app, `/admin/documents/${submitted.body.id}/url`, bearer(admin.accessToken));
    expect(first.status).toBe(200);
    expect(first.body.url).toContain('/api/v1/dev/storage/documents/');

    const afterFirst = await auditRowsFor(submitted.body.id);
    const views = afterFirst.filter(row => row.action === 'provider_document.view');
    expect(views).toHaveLength(1);
    expect(views[0]?.actorUserId).toBe(admin.userId);
    expect(views[0]?.actorRole).toBe('ADMIN');

    // A second view adds a second row rather than updating the first: who looked, how often.
    await callApi(app, `/admin/documents/${submitted.body.id}/url`, bearer(admin.accessToken));
    expect((await auditRowsFor(submitted.body.id)).filter(row => row.action === 'provider_document.view')).toHaveLength(2);
  });

  it('records the upload too, attributed to the provider', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    const rows = await auditRowsFor(submitted.body.id);
    expect(rows.filter(row => row.action === 'provider_document.upload')).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(provider.id);
    expect(rows[0]?.actorRole).toBe('PROVIDER');
  });

  it('records the review decision with the admin who made it', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    await callApi(app, `/admin/documents/${submitted.body.id}/review`, bearer(admin.accessToken, postJson({ status: 'VERIFIED' })));

    const reviews = (await auditRowsFor(submitted.body.id)).filter(row => row.action === 'provider_document.review');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.actorUserId).toBe(admin.userId);
  });

  it('writes no view audit row when the request was refused with 403', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    await callApi(app, `/admin/documents/${submitted.body.id}/url`, bearer(agent.accessToken));
    await callApi(app, `/admin/documents/${submitted.body.id}/url`, bearer(finance.accessToken));
    expect((await auditRowsFor(submitted.body.id)).filter(row => row.action === 'provider_document.view')).toHaveLength(0);
  });

  it('hands out a link that expires in about five minutes', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    const link = await callApi<{ url: string; expiresAt: string }>(app, `/admin/documents/${submitted.body.id}/url`, bearer(admin.accessToken));
    const seconds = (new Date(link.body.expiresAt).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(300);
  });
});

describe('FR-AD-10: document review', () => {
  it('records a verification and flips the provider’s CNIC state to verified', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64, cnicNumber: uniqueCnic() });

    const reviewed = await callApi<{ status: string; reviewedBy: string }>(app, `/admin/documents/${submitted.body.id}/review`, bearer(admin.accessToken, postJson({ status: 'VERIFIED' })));
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.status).toBe('VERIFIED');
    expect(reviewed.body.reviewedBy).toBe(admin.userId);

    const listed = await callApi<{ cnic: { hasCnic: boolean; cnicVerified: boolean } }>(app, '/provider/documents', bearer(provider.accessToken));
    expect(listed.body.cnic).toEqual({ hasCnic: true, cnicVerified: true });
  });

  it('refuses a rejection with no reason, because the reason is what the provider is told', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'CNIC_FRONT', contentType: 'image/png', contentBase64: PNG_BASE64 });
    const response = await callApi<{ code: string; errors: { path: string }[] }>(app, `/admin/documents/${submitted.body.id}/review`, bearer(admin.accessToken, postJson({ status: 'REJECTED' })));
    expect(response.status).toBe(422);
    expect(response.body.errors.map(error => error.path)).toContain('note');
  });

  it('will not let a reviewer set the status back to PENDING', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const submitted = await submitDocument(provider, { docType: 'TRADE_CERT', contentType: 'application/pdf', contentBase64: PNG_BASE64 });
    expect((await callApi(app, `/admin/documents/${submitted.body.id}/review`, bearer(admin.accessToken, postJson({ status: 'PENDING' })))).status).toBe(422);
  });

  it('404s on an unknown document rather than revealing anything', async () => {
    const response = await callApi<{ code: string }>(app, `/admin/documents/${'0'.repeat(8)}-0000-0000-0000-000000000000/url`, bearer(admin.accessToken));
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});

describe('FR-SP-06: presigned upload handshake', () => {
  it('mints an upload target scoped to the caller', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await callApi<{ storageKey: string; url: string; method: string; maxBytes: number }>(app, '/uploads/presign', bearer(provider.accessToken, postJson({ docType: 'CNIC_FRONT', contentType: 'image/jpeg' })));
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('PUT');
    expect(response.body.storageKey.startsWith(`${provider.id}/CNIC_FRONT/`)).toBe(true);
    expect(response.body.url).toContain('/api/v1/dev/storage/documents/');
    expect(response.body.maxBytes).toBeGreaterThan(0);
  });

  it('confirms a document uploaded to the presigned key', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const presigned = await callApi<{ storageKey: string }>(app, '/uploads/presign', bearer(provider.accessToken, postJson({ docType: 'TRADE_CERT', contentType: 'application/pdf' })));
    // The mock store has no PUT endpoint, so the test writes the bytes through the
    // same port the application uses, standing in for the client's direct upload.
    const { MockObjectStorage } = await import('../../src/integrations/mocks.js');
    const storage = app.get(MockObjectStorage);
    await storage.put({ key: presigned.body.storageKey, bucket: 'documents', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' });

    const confirmed = await submitDocument(provider, { docType: 'TRADE_CERT', storageKey: presigned.body.storageKey });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.storageKey).toBe(presigned.body.storageKey);
  });

  it('404s when confirming a key whose upload never landed', async () => {
    const provider = await registerAndVerify(app, 'PROVIDER');
    const response = await submitDocument(provider, { docType: 'TRADE_CERT', storageKey: `${provider.id}/TRADE_CERT/00000000-0000-0000-0000-000000000000` });
    expect(response.status).toBe(404);
  });

  it('refuses a key minted for a different provider', async () => {
    const mine = await registerAndVerify(app, 'PROVIDER');
    const theirs = await registerAndVerify(app, 'PROVIDER');
    const response = await submitDocument(mine, { docType: 'TRADE_CERT', storageKey: `${theirs.id}/TRADE_CERT/00000000-0000-0000-0000-000000000000` });
    expect(response.status).toBe(403);
    expect((response.body as unknown as { code: string }).code).toBe('FORBIDDEN');
  });

  it('is not available to a customer or to staff', async () => {
    const customer = await registerAndVerify(app, 'CUSTOMER');
    expect((await callApi(app, '/uploads/presign', bearer(customer.accessToken, postJson({ docType: 'TRADE_CERT', contentType: 'application/pdf' })))).status).toBe(403);
    expect((await callApi(app, '/uploads/presign', bearer(agent.accessToken, postJson({ docType: 'TRADE_CERT', contentType: 'application/pdf' })))).status).toBe(403);
    expect((await callApi(app, '/uploads/presign', { method: 'POST', body: JSON.stringify({ docType: 'TRADE_CERT', contentType: 'application/pdf' }) })).status).toBe(401);
  });
});
