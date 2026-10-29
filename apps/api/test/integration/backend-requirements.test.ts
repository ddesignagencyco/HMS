// apps/api/test/integration/backend-requirements.test.ts
//
// BE-001 / BE-014 / BE-016 / BE-024 from apps/web/docs/backend_requirement.md:
//  - evidence URLs are signed by the active storage port (not hand-built to the dev route), on all four read paths;
//  - evidence rows say which visit they belong to, and console / dispute rows carry their content type;
//  - a rework visit gives the customer a start code to show again;
//  - the ops-board stream stays up past Nest's SSE timer instead of crashing the process.
import { spawn } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import { OpsBoardController } from '../../src/admin/ops-board.controller.js';
import { AppClock } from '../../src/platform/app-clock.js';
import { OBJECT_STORAGE } from '../../src/integrations/integrations.module.js';
import type { ObjectStoragePort } from '../../src/integrations/ports.js';
import { callApi, createTestApp, postJson, staffSession } from './harness.js';
import { agentSession, agentVerify, bearer, claim, completedJob, doWorkAndComplete, dropLocks, freezeInsideCallingHours, newProvider, prisma, satisfied, startVisit, unfreeze, type Provider } from './flow.js';

let app: NestExpressApplication;
let close: () => Promise<void>;
let provider: Provider;
let agent: { accessToken: string; userId: string };
let admin: { accessToken: string; userId: string };
let finance: { accessToken: string; userId: string };

const SIGNED = 'https://signed.example/';

beforeAll(async () => {
  const started = await createTestApp();
  app = started.app;
  close = started.close;
  freezeInsideCallingHours(app);
  provider = await newProvider(app);
  agent = await agentSession(app, 'agent1');
  admin = await staffSession(app, 'superadmin@smart-home.local');
  finance = await staffSession(app, 'finance@smart-home.local');
});

afterEach(async () => {
  vi.restoreAllMocks();
  freezeInsideCallingHours(app);
  await dropLocks(agent.userId);
});

afterAll(async () => {
  unfreeze(app);
  await close();
  await prisma.$disconnect();
});

/** Makes the storage port sign URLs the way Supabase would, so any URL still built by hand is visibly not one of them. */
const signWith = (implementation?: ObjectStoragePort['presignGet']) =>
  vi.spyOn(app.get<ObjectStoragePort>(OBJECT_STORAGE), 'presignGet').mockImplementation(
    implementation ?? (async ({ key, bucket, ttlSeconds }) => ({ url: `${SIGNED}${bucket}/${encodeURIComponent(key)}?ttl=${ttlSeconds}`, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() }))
  );

describe('BE-001: evidence URLs are presigned by the storage port', () => {
  it('the booking evidence list signs each photo for 300 s from the evidence bucket, and says which visit it is from (BE-024)', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    const signer = signWith();
    const listed = await callApi<{ items: { kind: string; contentType: string; visitNo: number; url: string | null }[] }>(app, `/bookings/${job.id}/evidence`, bearer(job.customer.accessToken));
    expect(listed.status).toBe(200);
    expect(listed.body.items.length).toBeGreaterThanOrEqual(3);
    for (const item of listed.body.items) {
      expect(item.url).toMatch(/^https:\/\/signed\.example\/evidence\//);
      expect(item.url).toContain('ttl=300');
      expect(item.url).not.toContain('/dev/storage');
      expect(item.visitNo).toBe(1);
    }
    expect(signer).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'evidence', ttlSeconds: 300 }));
  });

  it('an object the store cannot find answers a null url rather than failing the whole list', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    signWith(async () => {
      throw new Error('Object not found');
    });
    const listed = await callApi<{ items: { url: string | null }[] }>(app, `/bookings/${job.id}/evidence`, bearer(job.customer.accessToken));
    expect(listed.status).toBe(200);
    expect(listed.body.items.every(item => item.url === null)).toBe(true);
  });

  it('the agent console signs each photo and carries contentType and visitNo', async () => {
    const job = await completedJob(app, provider);
    expect((await claim(app, agent.accessToken, job.verificationId)).status).toBe(200);
    signWith();
    const console_ = await callApi<{ evidence: { kind: string; contentType: string; visitNo: number; url: string }[] }>(app, `/agent/verifications/${job.verificationId}`, bearer(agent.accessToken));
    expect(console_.status).toBe(200);
    expect(console_.body.evidence.length).toBeGreaterThanOrEqual(3);
    for (const row of console_.body.evidence) {
      expect(row.url).toMatch(/^https:\/\/signed\.example\/evidence\//);
      expect(row.contentType).toBe('image/jpeg');
      expect(row.visitNo).toBe(1);
    }
  });

  it('the dispute case signs each photo and carries contentType', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE', minutesOnSite: 50 });
    const disputed = await agentVerify(app, agent, job, { ...satisfied, workCompleted: 'NONE', quality: 1, punctuality: 1, conduct: 1, cleanliness: 1, uniformWorn: false, ownTools: false, consentToRelease: false, outcome: 'DISPUTED' });
    expect(disputed.body.bookingStatus).toBe('DISPUTED');
    const disputeId = (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM disputes WHERE booking_id = ${job.id}::uuid`))[0]!.id;

    signWith();
    const floor = await callApi<{ evidenceFloor: { photos: { contentType: string; visitNo: number; url: string }[] } }>(app, `/admin/disputes/${disputeId}`, bearer(admin.accessToken));
    expect(floor.status).toBe(200);
    expect(floor.body.evidenceFloor.photos.length).toBeGreaterThanOrEqual(3);
    for (const photo of floor.body.evidenceFloor.photos) {
      expect(photo.url).toMatch(/^https:\/\/signed\.example\/evidence\//);
      expect(photo.contentType).toBe('image/jpeg');
    }
  });

  it('the complaint timeline signs each photo', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    await agentVerify(app, agent, job);
    const raised = await callApi<{ id: string }>(
      app,
      '/complaints',
      bearer(job.customer.accessToken, postJson({ bookingId: job.id, category: 'QUALITY', description: 'The problem is described here in enough words.', photos: [{ contentType: 'image/jpeg', contentBase64: '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==' }] }))
    );
    expect(raised.status).toBe(201);
    signWith();
    const read = await callApi<{ timeline: { type: string; evidenceUrl: string | null }[] }>(app, `/complaints/${raised.body.id}`, bearer(job.customer.accessToken));
    expect(read.status).toBe(200);
    const evidence = read.body.timeline.filter(event => event.type === 'EVIDENCE_ADDED');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.evidenceUrl).toMatch(/^https:\/\/signed\.example\/evidence\//);
  });
});

describe('BE-014 / BE-024: a rework visit', () => {
  const startOtpVerifiedAt = async (bookingId: string): Promise<Date | null> =>
    (await prisma.$queryRaw<{ at: Date | null }[]>(Prisma.sql`SELECT start_otp_verified_at as at FROM bookings WHERE id = ${bookingId}::uuid`))[0]!.at;

  const showCode = async (job: { id: string; customer: { accessToken: string } }) => {
    const scheduled = (await prisma.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT scheduled_start as at FROM bookings WHERE id = ${job.id}::uuid`))[0]!.at;
    app.get(AppClock).travelTo(scheduled);
    return callApi<{ code: string }>(app, `/bookings/${job.id}/start-code`, bearer(job.customer.accessToken, { method: 'POST' }));
  };

  it('clears the verified start when verification sends the provider back, so the customer can show the new code', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    expect(await startOtpVerifiedAt(job.id)).not.toBeNull();

    const result = await agentVerify(app, agent, job, { ...satisfied, workCompleted: 'PARTIAL', outcome: 'REWORK_REQUIRED' });
    expect(result.body.bookingStatus).toBe('REWORK_REQUIRED');
    expect(await startOtpVerifiedAt(job.id)).toBeNull();

    const shown = await showCode(job);
    expect(shown.status).toBe(200);
    expect(shown.body.code).toMatch(/^\d{4,8}$/);
  });

  it('does the same for a warranty claim, and the second visit then starts normally with its own evidence (visitNo 2)', async () => {
    const job = await completedJob(app, provider, { mode: 'ONLINE' });
    expect((await agentVerify(app, agent, job)).body.released).toBe(true);
    const claimed = await callApi<{ status: string }>(app, `/bookings/${job.id}/warranty-claim`, bearer(job.customer.accessToken, postJson({ reason: 'The joint is leaking again' })));
    expect(claimed.body.status).toBe('REWORK_REQUIRED');
    expect(await startOtpVerifiedAt(job.id)).toBeNull();
    expect((await showCode(job)).status).toBe(200);

    unfreeze(app);
    freezeInsideCallingHours(app);
    await startVisit(app, provider, job.customer, job.id, 60);
    expect(await startOtpVerifiedAt(job.id)).not.toBeNull();
    await doWorkAndComplete(app, provider, job.customer, job.id);

    const listed = await callApi<{ items: { visitNo: number }[] }>(app, `/bookings/${job.id}/evidence`, bearer(job.customer.accessToken));
    const visits = new Set(listed.body.items.map(item => item.visitNo));
    expect([...visits].sort()).toEqual([1, 2]);
  });
});

describe('BE-016: the ops-board stream does not take the process down', () => {
  it('is a plain handler that owns its response, not an @Sse handler that also writes to it', () => {
    // Nest's SSE machinery writes the response headers itself, on its own schedule, so a handler that has already written them through
    // `@Res()` makes it throw an uncaught ERR_HTTP_HEADERS_SENT (on the Nest versions the audit saw). The two must never be combined.
    const handler = Object.getOwnPropertyDescriptor(OpsBoardController.prototype, 'stream')?.value as object;
    expect(Reflect.getMetadata('__sse__', handler)).toBeUndefined();
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
  });

  // A real server in a child process, over a real socket: the crash was Nest's SSE timer throwing an uncaught ERR_HTTP_HEADERS_SENT five seconds
  // into an open stream, which only exists on a live connection (the in-process harness dispatches requests without a socket) and which
  // terminates the whole process, so the test has to be able to watch a process die without being it.
  it('keeps a stream open past the five-second SSE timer, keeps pushing, and the API process is still alive and serving afterwards', async () => {
    const port = 3200 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}/api/v1`;
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), API_HOST: '127.0.0.1', WORKER_METRICS_PORT: String(port + 1000) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    const controller = new AbortController();
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`the API process exited while starting: ${output.slice(-800)}`);
        if (attempt > 120) throw new Error(`the API process did not start: ${output.slice(-800)}`);
        const up = await fetch(`${base}/health`).then(response => response.status < 500, () => false);
        if (up) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const response = await fetch(`${base}/admin/ops-board/stream`, { headers: { authorization: `Bearer ${finance.accessToken}` }, signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let received = '';
      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          received += decoder.decode(value, { stream: true });
        }
      })().catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 7_000));
      const aliveWhileOpen = child.exitCode === null;
      controller.abort();
      await pump;

      expect(aliveWhileOpen, output.slice(-800)).toBe(true);
      expect(received).toContain('event: board');
      expect(received).toContain('"generatedAt"');
      expect(child.exitCode).toBeNull();
      expect((await fetch(`${base}/health`)).status).toBeLessThan(500);
    } finally {
      controller.abort();
      child.kill();
    }
  }, 120_000);
});
