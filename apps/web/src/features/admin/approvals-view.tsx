'use client';

import { useState } from 'react';
import { BadgeCheck, FileText, Loader2, ShieldBan } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';
import { useProviderDocuments, useReviewDocument } from '@/features/admin/cases-queries';
import { useApproveProvider, useDeactivateProvider, useRejectProvider, useAdminUsers } from '@/features/admin/queries';
import { detailOf, toastSuccess } from '@/features/auth/auth-feedback';
import { ApiError } from '@/lib/api/problem';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, formatDateTime, type Locale } from '@/lib/utils';

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
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-navy">{name}</h2>
          <p className="mt-1 font-mono text-[11px] text-muted">{providerId}</p>
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
