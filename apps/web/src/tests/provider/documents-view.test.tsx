import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderDocumentsScreen } from '@/features/provider/documents-view';
import { getDictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* Identity documents.

   The contract facts that matter here:

   · `GET /provider/documents` returns `{ items, cnic }`, and `cnic` is only
     `{ hasCnic, cnicVerified }`. **The CNIC number is never returned by any
     endpoint.** A test asserts the number never reaches the DOM even when the
     person typed one — the screen submits it and must never read it back.
   · Submitting is **presigned**: `POST /uploads/presign` → PUT the bytes to the
     signed Supabase Storage URL → `POST /provider/documents { storageKey }`.
     Inline base64 cannot carry a real file: that route's JSON limit is 1 MB. The
     tests assert the bytes go to storage with their content type, and that the
     API only ever receives the key — never `contentBase64`, per the either/or.
   · JPEG, PNG, WebP, PDF and MP4/WebM/MOV video are accepted (images and PDFs
     up to 5 MB, video up to 50 MB); `documentContentTypes` has no octet-stream,
     so an unsupported file is refused before the round trip.
   · A CNIC number may only accompany a CNIC front or back scan. */

const dict = getDictionary('en');
const locale: Locale = 'en';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } }
  });
  const Component = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ProviderDocumentsScreen locale={locale} dict={dict} />, { wrapper: Component });
};

const document_ = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'd1',
  providerId: '00000000-0000-4000-8000-000000000098',
  docType: 'CNIC_FRONT',
  status: 'PENDING',
  storageKey: 'provider/00000000-0000-4000-8000-000000000098/cnic-front.jpg',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over
});

let list = { items: [document_()], cnic: { hasCnic: true, cnicVerified: false } };
const STORAGE_HOST = 'https://project.supabase.co';
let storageStatus = 200;

/** A File in jsdom: a real Blob with a name, so `file.type` and `file.size` work. */
const pngFile = (name = 'cnic.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3, 4])], name, { type });

const callsTo = (fragment: string, method: string) =>
  (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url, init]) => String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method);

beforeEach(() => {
  list = { items: [document_()], cnic: { hasCnic: true, cnicVerified: false } };
  storageStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      // The storage PUT goes to Supabase, a third-party host, as a separate fetch.
      if (url.startsWith(STORAGE_HOST)) return new Response(storageStatus === 200 ? '{"Key":"documents/x"}' : '{"error":"expired"}', { status: storageStatus });
      if (method === 'POST' && url.includes('/uploads/presign')) {
        const body = JSON.parse(String(init?.body)) as { contentType: string };
        return json({
          storageKey: 'provider/x/cnic-front.png',
          url: `${STORAGE_HOST}/storage/v1/object/upload/sign/verification-documents/provider/x/cnic-front.png?token=t`,
          method: 'PUT',
          expiresAt: '2026-10-01T00:05:00.000Z',
          maxBytes: body.contentType.startsWith('video/') ? 50 * 1024 * 1024 : 5 * 1024 * 1024
        });
      }
      if (method === 'POST' && url.includes('/provider/documents')) return json(document_({ status: 'PENDING' }));
      if (method === 'GET' && url.includes('/provider/documents')) return json(list);
      throw new Error(`unrouted ${method} ${url}`);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('provider documents', () => {
  it('lists the documents on file with their review state', async () => {
    renderScreen();
    /* Once in the submitted list, once as an option in the "kind" picker — both
       are correct, so the assertion is on the list row itself. */
    expect((await screen.findAllByText('CNIC — front')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(dict.portal.docStatus.PENDING)).toBeDefined();
    expect(screen.getByText(dict.portal.docPendingNote)).toBeDefined();
  });

  it('shows a rejection note when there is one', async () => {
    list = { items: [document_({ status: 'REJECTED', reviewNote: 'The scan is too blurry to read.' })], cnic: { hasCnic: true, cnicVerified: false } };
    renderScreen();
    expect(await screen.findByText('The scan is too blurry to read.')).toBeDefined();
  });

  it('never renders the CNIC number, because the API never returns it', async () => {
    list = { items: [], cnic: { hasCnic: true, cnicVerified: true } };
    renderScreen();
    await screen.findByText(dict.portal.cnicVerified);
    expect(document.body.textContent).not.toContain('35202');
    /* The response carries only hasCnic/cnicVerified — there is nothing else to
       accidentally leak, and the screen must not pretend otherwise. */
    expect(JSON.stringify(list)).not.toContain('35202');
  });

  it('reports the CNIC state from the API, not a guess', async () => {
    list = { items: [], cnic: { hasCnic: false, cnicVerified: false } };
    renderScreen();
    expect(await screen.findByText(dict.portal.cnicMissing)).toBeDefined();
  });

  it('says so when nothing has been submitted', async () => {
    list = { items: [], cnic: { hasCnic: false, cnicVerified: false } };
    renderScreen();
    expect(await screen.findByText(dict.portal.noDocuments)).toBeDefined();
  });

  it('refuses a file type the API does not accept', async () => {
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile('notes.txt', 'text/plain')] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByText(dict.portal.fileTypeUnsupported)).toBeDefined();
    expect(callsTo('/uploads/presign', 'POST')).toHaveLength(0);
  });

  it('refuses an empty submission before calling anything', async () => {
    renderScreen();
    await screen.findByLabelText(dict.portal.chooseFileLabel);
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByText(dict.portal.chooseFileFirst)).toBeDefined();
    expect(callsTo('/uploads/presign', 'POST')).toHaveLength(0);
  });

  it('uploads the bytes to Supabase Storage and records only the key', async () => {
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));

    await waitFor(() => expect(screen.getByText(dict.portal.documentSubmitted)).toBeDefined());

    const presign = callsTo('/uploads/presign', 'POST');
    expect(presign).toHaveLength(1);
    expect(JSON.parse(String((presign[0][1] as RequestInit).body))).toEqual({ docType: 'CNIC_FRONT', contentType: 'image/png' });

    /* The bytes go straight to storage, typed — Supabase records the header as the object's type. */
    const put = callsTo(STORAGE_HOST, 'PUT');
    expect(put).toHaveLength(1);
    const putInit = put[0][1] as RequestInit;
    expect((putInit.headers as Record<string, string>)['content-type']).toBe('image/png');
    expect(putInit.credentials).toBe('omit');
    expect(putInit.body).toBeInstanceOf(File);

    const confirm = callsTo('/provider/documents', 'POST');
    expect(confirm).toHaveLength(1);
    const body = JSON.parse(String((confirm[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toEqual({ docType: 'CNIC_FRONT', storageKey: 'provider/x/cnic-front.png' });
  });

  it('accepts a video document, typed from its extension when the browser gives none', async () => {
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile('walkthrough.mov', '')] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));

    await waitFor(() => expect(screen.getByText(dict.portal.documentSubmitted)).toBeDefined());
    expect(JSON.parse(String((callsTo('/uploads/presign', 'POST')[0][1] as RequestInit).body)).contentType).toBe('video/quicktime');
  });

  it('refuses an image over 5 MB before calling anything', async () => {
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'scan.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByText(dict.portal.fileTooLarge.replace('{max}', '5'))).toBeDefined();
    expect(callsTo('/uploads/presign', 'POST')).toHaveLength(0);
  });

  it('records nothing when storage refuses the upload', async () => {
    storageStatus = 400;
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(callsTo('/provider/documents', 'POST')).toHaveLength(0);
    expect(screen.queryByText(dict.portal.documentSubmitted)).toBeNull();
  });

  it('sends the CNIC number only with a CNIC scan', async () => {
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.change(await screen.findByLabelText(dict.portal.cnicNumberLabel), {
      target: { value: '35202-1234567-1' }
    });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));

    await waitFor(() => expect(screen.getByText(dict.portal.documentSubmitted)).toBeDefined());
    const confirm = callsTo('/provider/documents', 'POST');
    expect(JSON.parse(String((confirm[0][1] as RequestInit).body)).cnicNumber).toBe('35202-1234567-1');
    /* …and it is not read back into the page. */
    expect(document.body.textContent).not.toContain('35202-1234567-1');
  });

  /* The onboarding "documents" step is satisfied by `cnic_enc`, which only a
     `cnicNumber` sent with a CNIC scan sets — so the first CNIC scan needs it. */
  it('requires the CNIC number with a CNIC scan until one is on file', async () => {
    list = { items: [], cnic: { hasCnic: false, cnicVerified: false } };
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect(await screen.findByLabelText(dict.portal.cnicNumberRequiredLabel)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByText(dict.portal.cnicNumberRequired)).toBeDefined();
    expect(callsTo('/uploads/presign', 'POST')).toHaveLength(0);
  });

  it('refuses a CNIC number that is not 13 digits before uploading', async () => {
    list = { items: [], cnic: { hasCnic: false, cnicVerified: false } };
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.change(await screen.findByLabelText(dict.portal.cnicNumberRequiredLabel), { target: { value: '35202-12345' } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByText(dict.portal.cnicNumberInvalid)).toBeDefined();
    expect(callsTo('/uploads/presign', 'POST')).toHaveLength(0);
  });

  it('reports a failure without claiming the document was recorded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input);
        if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
          return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'could not store', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          });
        }
        if (url.includes('/provider/documents')) return json(list);
        throw new Error(`unrouted ${url}`);
      })
    );
    renderScreen();
    const input = (await screen.findByLabelText(dict.portal.chooseFileLabel)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole('button', { name: dict.portal.submitDocument }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText(dict.portal.documentSubmitted)).toBeNull();
  });

  it('reports a failure to load documents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ type: 'about:blank', title: 'x', status: 500, code: 'INTERNAL_ERROR', detail: 'x', errors: [] }), {
            status: 500,
            headers: { 'content-type': 'application/problem+json' }
          })
      )
    );
    renderScreen();
    expect(await screen.findByText(dict.portal.documentsLoadError)).toBeDefined();
  });
});
