'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ExternalLink, Eye, FileText, Loader2, ShieldBan, X } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { isDevStorageUrl, mediaKindOf } from '@/components/evidence-image';
import { providerDocumentsApi } from '@/features/admin/cases-api';
import { useProviderDocuments, useReviewDocument } from '@/features/admin/cases-queries';
import { useApproveProvider, useDeactivateProvider, useRejectProvider, useAdminUsers } from '@/features/admin/queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatDateTime, localizedPath, type Locale } from '@/lib/utils';

/* Professional approvals — the `admin/providers` block and the `admin/documents`
 * review routes.
 *
 * **There is no admin providers list.** The only route that enumerates
 * professionals is `GET /admin/users?role=PROVIDER`, and that publishes each
 * account's `roles` and `status` — `user_status`, which is ACTIVE/LOCKED/
 * DEACTIVATED — but **not** `provider_status`, which is the thing an approval
 * queue exists to act on (PENDING_APPROVAL vs SUSPENDED vs BLOCKED).
 *
 * So this screen is honest about what it has: it lists the professionals the users
 * route returns and says plainly that their approval state is not published, rather
 * than labelling every row "approved" or showing a column that would be guessed.
 * The document route *does* publish the review state per document, and CNIC
 * verification, and that is what gates approval server-side anyway
 * (`verification.require_verified_cnic`), so it is what this screen reads.
 *
 * **A rejection requires a reason**, because `providerRejectSchema` demands it and
 * because it is the text the professional is shown. Approval is refused with a 409
 * until the CNIC is verified, so the button is disabled with that reason stated
 * rather than offered and left to fail.
 *
 * **`storageKey` is never rendered.** It is a storage key, not a URL; the file is
 * fetched through the signed-url route, and every call to it is audited. */

export function AdminApprovals({ locale, dict, providerId }: { locale: Locale; dict: Dictionary; providerId?: string }) {
  /* `providerId` scopes the screen to one professional, which is what
     `/admin/providers/[id]` renders. It is the same screen and the same rows —
     there is no separate "provider detail" endpoint to read, because there is no
     admin providers list at all (see the note above). */
  const providers = useAdminUsers({ role: 'PROVIDER', limit: 200 }, locale);
  const all = providers.data?.items ?? [];
  const rows = providerId === undefined ? all : all.filter((row) => row.id === providerId);
  const forbidden = providers.error instanceof ApiError && providers.error.status === 403;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.admin} title={dict.admin.approvals} description={dict.admin.approvalsText} />

      <p className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{dict.admin.providerStatusNotPublished}</p>

      {providers.isPending ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.admin.loadingProviders}
        </Card>
      ) : providers.isError ? (
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.admin.providersLoadError}</p>
          {forbidden ? <p className="mt-2 text-sm leading-6 text-rose-800">{dict.admin.adminTotpRequired}</p> : null}
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void providers.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6 border-dashed px-6 py-14 text-center">
          <h2 className="font-semibold text-navy">{providerId === undefined ? dict.admin.noProviders : dict.admin.noSuchProvider}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-secondary">{providerId === undefined ? dict.admin.noProvidersText : dict.admin.noSuchProviderText}</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <ProviderApprovalCard locale={locale} dict={dict} providerId={row.id} name={[row.firstName, row.lastName].filter(Boolean).join(' ')} joined={row.createdAt} accountStatus={row.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderApprovalCard({
  locale,
  dict,
  providerId,
  name,
  joined,
  accountStatus
}: {
  locale: Locale;
  dict: Dictionary;
  providerId: string;
  name: string;
  joined: string;
  accountStatus: string;
}) {
  const documents = useProviderDocuments(providerId, locale);
  const cnic = documents.data?.cnic;
  const approve = useApproveProvider(locale);
  const reject = useRejectProvider(locale);
  const deactivate = useDeactivateProvider(locale);
  const review = useReviewDocument(locale);

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  /* The server refuses approval until the CNIC is verified, so the control says so
     instead of offering a button whose only possible answer is a 409. */
  const canApprove = cnic?.cnicVerified === true;

  const [viewingDoc, setViewingDoc] = useState<{ id: string; docType: string; status: string } | null>(null);

  const doApprove = async (): Promise<void> => {
    try {
      await approve.mutateAsync(providerId);
      toastSuccess(dict.admin.providerApproved);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  const doReject = async (): Promise<void> => {
    setError('');
    if (reason.trim().length < 3) {
      setError(dict.admin.rejectReasonRequired);
      return;
    }
    try {
      await reject.mutateAsync({ providerId, reason: reason.trim() });
      toastSuccess(dict.admin.providerRejected);
      setRejecting(false);
      setReason('');
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-navy">
                <Link
                  href={localizedPath(locale, `/providers/${providerId}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary-strong hover:underline inline-flex items-center gap-1.5"
                >
                  {name}
                  <ExternalLink className="size-3 text-muted" aria-hidden="true" />
                </Link>
              </h2>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                Pro #{providerId.slice(-6).toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {dict.admin.joined} {formatDate(joined, locale)} · {dict.admin.accountStatus}: {accountStatus}
            </p>
          </div>
          {cnic === undefined ? null : (
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                cnic.cnicVerified ? 'bg-emerald-50 text-emerald-700' : cnic.hasCnic ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'
              )}
            >
              {cnic.cnicVerified ? dict.admin.cnicVerified : cnic.hasCnic ? dict.admin.cnicAwaitingReview : dict.admin.noCnic}
            </span>
          )}
        </div>

        {documents.isPending ? (
          <p className="mt-4 text-sm text-muted">{dict.admin.loadingDocuments}</p>
        ) : documents.isError ? (
          <p role="alert" className="mt-4 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
            {dict.admin.documentsLoadError}
          </p>
        ) : documents.data.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{dict.admin.noDocuments}</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {documents.data.items.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-line bg-surface-2 p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-navy">
                    <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    {dict.admin.docTypes[document.docType as keyof typeof dict.admin.docTypes] ?? document.docType}
                  </p>
                  <p className="mt-1 text-xs text-muted">{formatDateTime(document.createdAt, locale)}</p>
                  {document.reviewNote === null ? null : <p className="mt-1 text-xs text-secondary">{document.reviewNote}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      document.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700' : document.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'
                    )}
                  >
                    {dict.admin.documentStates[document.status as keyof typeof dict.admin.documentStates] ?? document.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewingDoc({ id: document.id, docType: document.docType, status: document.status })}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                  >
                    <Eye className="size-3.5 text-slate-500" aria-hidden="true" />
                    {dict.admin.viewDocument}
                  </button>
                  {document.status === 'PENDING' ? <DocumentDecision dict={dict} documentId={document.id} review={review} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button type="button" disabled={!canApprove || approve.isPending} onClick={() => void doApprove()}>
            {approve.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <BadgeCheck className="size-4" aria-hidden="true" />}
            {dict.admin.approve}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRejecting((value) => !value)}
            aria-expanded={rejecting}
            /* Named, because the document list on this same card has its own
               "Reject" and two controls reading identically cannot be told apart —
               by a screen reader or by anyone reaching for the right one. */
            aria-label={`${dict.admin.reject}: ${name}`}
          >
            <ShieldBan className="size-4" aria-hidden="true" />
            {dict.admin.reject}
          </Button>
          {accountStatus !== 'DEACTIVATED' ? (
            <Button type="button" variant="ghost" size="sm" disabled={deactivate.isPending} onClick={() => void deactivate.mutateAsync(providerId)} className="text-rose-700">
              {dict.admin.deactivateProvider}
            </Button>
          ) : null}
          {!canApprove ? <p className="text-xs leading-5 text-amber-800">{dict.admin.approveBlocked}</p> : null}
        </div>

        {rejecting ? (
          <div className="mt-3 grid gap-2 rounded-[9px] border border-line bg-surface-2 p-3">
            <label htmlFor={`reject-${providerId}`} className="text-[11.5px] font-semibold text-slate-800">
              {dict.admin.rejectReason}
            </label>
            <input
              id={`reject-${providerId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={dict.admin.rejectReasonPlaceholder}
              className="min-h-11 rounded-[9px] border border-line bg-white px-3 text-sm text-navy outline-none focus:border-primary"
            />
            <Button type="button" size="sm" disabled={reject.isPending} onClick={() => void doReject()} aria-label={dict.admin.rejectConfirm}>
              {dict.admin.reject}
            </Button>
          </div>
        ) : null}

        {error !== '' ? (
          <p role="alert" className="mt-3 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </Card>

      {viewingDoc !== null ? (
        <DocumentPreviewModal
          documentId={viewingDoc.id}
          docType={viewingDoc.docType}
          status={viewingDoc.status}
          locale={locale}
          dict={dict}
          onClose={() => setViewingDoc(null)}
          review={review}
        />
      ) : null}
    </>
  );
}

/** Verify or reject one document. A rejection must carry a note — the schema
    requires it, and it is what the professional is told. */
function DocumentDecision({ dict, documentId, review }: { dict: Dictionary; documentId: string; review: ReturnType<typeof useReviewDocument> }) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');

  const verify = async (): Promise<void> => {
    try {
      await review.mutateAsync({ documentId, status: 'VERIFIED' });
      toastSuccess(dict.admin.documentVerified);
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  const rejectDocument = async (): Promise<void> => {
    setError('');
    if (note.trim().length < 1) {
      setError(dict.admin.rejectReasonRequired);
      return;
    }
    try {
      await review.mutateAsync({ documentId, status: 'REJECTED', note: note.trim() });
      toastSuccess(dict.admin.documentRejected);
      setRejecting(false);
      setNote('');
    } catch (caught) {
      setError(detailOf(caught, dict));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={review.isPending} onClick={() => void verify()}>
        {dict.admin.verify}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting((value) => !value)} aria-expanded={rejecting} className="text-rose-700">
        {dict.admin.reject}
      </Button>
      {rejecting ? (
        <span className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={dict.admin.rejectReasonPlaceholder}
            aria-label={dict.admin.rejectReason}
            className="min-h-9 rounded-[8px] border border-line bg-white px-2 text-[13px] text-navy outline-none focus:border-primary"
          />
          <Button type="button" size="sm" disabled={review.isPending} onClick={() => void rejectDocument()}>
            {dict.admin.reject}
          </Button>
        </span>
      ) : null}
      {error !== '' ? (
        <span role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function DocumentPreviewModal({
  documentId,
  docType,
  status,
  locale,
  dict,
  onClose,
  review
}: {
  documentId: string;
  docType: string;
  status: string;
  locale: Locale;
  dict: Dictionary;
  onClose: () => void;
  review: ReturnType<typeof useReviewDocument>;
}) {
  /* `src` is what the element loads — an object URL of the fetched bytes, or the
     dev mock's unwrapped data URL. `contentType` picks the element: since the
     Supabase switch a document may be a PDF or a video, and an <img> shows
     neither. `external` is the signed link itself, offered as "open in a new
     tab" (never for the mock, whose route answers JSON). */
  const [media, setMedia] = useState<{ src: string; contentType: string; external: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Signed links last five minutes (`SIGNED_URL_SECONDS`), so "try again" means
     "sign a new one", not "reload the old one". */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    const fetchDoc = async () => {
      try {
        setLoading(true);
        setError(null);
        setMedia(null);
        const signed = await providerDocumentsApi.signedUrl(documentId, { locale });
        if (!active) return;

        if (isDevStorageUrl(signed.url)) {
          const res = await fetch(signed.url, { signal: controller.signal, headers: { accept: 'application/json' } });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { contentType?: string; contentBase64?: string };
          if (typeof data.contentBase64 !== 'string') throw new Error('no content');
          const type = data.contentType ?? 'image/png';
          if (active) setMedia({ src: `data:${type};base64,${data.contentBase64}`, contentType: type, external: null });
          return;
        }

        /* A real Supabase signed URL. Read once as a blob: the response's own
           Content-Type is the only reliable statement of what the file is (the
           row carries no type and the key has no extension). Supabase Storage
           answers CORS for any origin, and the link is the credential, so no
           cookies go with it. */
        const res = await fetch(signed.url, { signal: controller.signal, credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setMedia({ src: objectUrl, contentType: blob.type || res.headers.get('content-type') || 'application/octet-stream', external: signed.url });
      } catch (err) {
        if (!active || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'preview failed');
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchDoc();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, locale, attempt]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 sm:p-6 backdrop-blur-xs"
    >
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="size-5 text-blue-700" aria-hidden="true" />
            <div>
              <h3 id="doc-preview-title" className="text-base font-bold text-navy">
                {dict.admin.docTypes[docType as keyof typeof dict.admin.docTypes] ?? docType}
              </h3>
              <p className="text-xs text-muted">{dict.admin.documentPreview}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
            aria-label={dict.admin.closePreview}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-6 bg-slate-900/5 flex items-center justify-center min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted">
              <Loader2 className="size-8 animate-spin text-blue-600" aria-hidden="true" />
              <p className="text-sm font-medium">{dict.admin.loadingDocuments}</p>
            </div>
          ) : error !== null || media === null ? (
            <div role="alert" className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
              <p className="text-sm font-semibold text-amber-900">{dict.admin.previewUnavailableTitle}</p>
              <p className="mt-2 text-xs leading-5 text-amber-800">{dict.admin.previewUnavailableText}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => setAttempt((count) => count + 1)}>
                {dict.admin.previewRetry}
              </Button>
            </div>
          ) : (
            <div className="flex w-full max-w-full flex-col items-center gap-3">
              {mediaKindOf(media.contentType) === 'pdf' ? (
                <iframe src={media.src} title={docType} className="h-[60vh] w-full rounded-lg border border-slate-200/80 bg-white shadow-md" />
              ) : mediaKindOf(media.contentType) === 'video' ? (
                <video src={media.src} controls playsInline preload="metadata" className="max-h-[60vh] max-w-full rounded-lg border border-slate-200/80 bg-black shadow-md" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL of a privately stored file
                <img
                  src={media.src}
                  alt={docType}
                  onError={() => setError('image failed')}
                  className="max-h-[60vh] max-w-full rounded-lg border border-slate-200/80 object-contain shadow-md bg-white"
                />
              )}
              {media.external !== null ? (
                <a href={media.external} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-strong underline">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {dict.admin.previewOpenNewTab}
                </a>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
              )}
            >
              {dict.admin.documentStates[status as keyof typeof dict.admin.documentStates] ?? status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {status === 'PENDING' ? (
              <DocumentDecision dict={dict} documentId={documentId} review={review} />
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {dict.admin.closePreview}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
