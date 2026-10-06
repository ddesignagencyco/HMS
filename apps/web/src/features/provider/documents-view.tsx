'use client';

import { AlertTriangle, CheckCircle2, Clock3, FileUp, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Input, Label, PageHeader } from '@/components/ui';
import { SelectField } from '@/components/select-field';
import { presignUpload, putToPresignedTarget } from '@/features/uploads/api';
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, type DocumentContentType, type ProviderDocument, type ProviderDocumentKind } from '@/features/provider/api';
import { useProviderDocuments, useSubmitDocument } from '@/features/provider/queries';
import type { Dictionary } from '@/lib/dictionaries';
import { cn, formatDate, type Locale } from '@/lib/utils';

/* Identity documents.

   The provider proves who they are here, and the shape of the flow is dictated
   by the API:

   · `GET /provider/documents` returns `{ items, cnic }` — and `cnic` is only
     `{ hasCnic, cnicVerified }`. The CNIC **number is never returned by any
     endpoint**; it is encrypted at rest. So this screen cannot display it, must
     not cache it, and must not pretend a number is missing because it failed to
     load. It is not the API's to give back.

   · Submitting is one of two shapes, and `documentSubmitSchema` refuses both and
     neither: inline base64, or a presigned key. This uses **presigned**, because a
     CNIC scan on a phone is exactly the case where a single large JSON body is
     what fails.

   · A rejected document can be replaced; evidence is insert-only, documents are
     not. So "Replace" is really "submit again", and the old row stays visible. */

/** The four kinds, in the order a provider should supply them. */
const KINDS: ProviderDocumentKind[] = ['CNIC_FRONT', 'CNIC_BACK', 'TRADE_CERTIFICATE', 'CHARACTER_CERTIFICATE'];

const STATUS_TONE = {
  APPROVED: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  REJECTED: 'bg-rose-50 text-rose-700'
} as const;

export function ProviderDocumentsScreen({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const documents = useProviderDocuments(locale);
  const submit = useSubmitDocument(locale);

  const [kind, setKind] = useState<ProviderDocumentKind>('CNIC_FRONT');
  const [cnicNumber, setCnicNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [done, setDone] = useState('');

  const cnic = documents.data?.cnic;

  const send = async (): Promise<void> => {
    setLocalError('');
    setDone('');
    if (file === null) {
      setLocalError(dict.portal.chooseFileFirst);
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      /* `maxBytes` is the store's own ceiling; the API would refuse it anyway. */
      setLocalError(dict.portal.fileTooLarge.replace('{max}', String(Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024))));
      return;
    }
    const contentType = file.type as DocumentContentType;
    if (!DOCUMENT_CONTENT_TYPES.includes(contentType)) {
      /* `documentContentTypes` is deliberately narrow — no octet-stream — so an
         unexpected type is refused here rather than as a 422. */
      setLocalError(dict.portal.fileTypeUnsupported);
      return;
    }
    /* The CNIC number only belongs on a CNIC scan, and the schema refuses it on
       anything else. */
    if (cnicNumber.trim() !== '' && kind !== 'CNIC_FRONT' && kind !== 'CNIC_BACK') {
      setLocalError(dict.portal.cnicNumberNeedsCnicDoc);
      return;
    }

    setBusy(true);
    /* Minted per chosen file and reused across attempts, so a retry after a dropped
       connection confirms the same key rather than leaving an orphan object. */
    const clientUuid = crypto.randomUUID();
    try {
      const target = await presignUpload({ docType: kind, contentType }, clientUuid, locale);
      await putToPresignedTarget(target, file);
      await submit.mutateAsync({
        docType: kind,
        clientUuid,
        storageKey: target.storageKey,
        ...(cnicNumber.trim() === '' ? {} : { cnicNumber: cnicNumber.trim() })
      });
      setDone(dict.portal.documentSubmitted);
      setFile(null);
      setCnicNumber('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : dict.portal.documentUploadFailed);
    } finally {
      setBusy(false);
    }
  };

  if (documents.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="grid gap-3">
        <span className="skeleton h-8 w-56 rounded-[9px]" />
        <span className="skeleton h-48 w-full rounded-[12px]" />
      </div>
    );
  }

  if (documents.isError) {
    return (
      <div>
        <PageHeader eyebrow={dict.portal.provider} title={dict.portal.documents} />
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">{dict.portal.documentsLoadError}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void documents.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      </div>
    );
  }

  const rows = documents.data.items;

  return (
    <div>
      <PageHeader eyebrow={dict.portal.provider} title={dict.portal.documents} description={dict.portal.documentsText} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <h2 className="font-semibold text-navy">{dict.portal.yourDocuments}</h2>

          {rows.length === 0 ? (
            <p className="mt-4 rounded-[9px] border border-line bg-surface-2 p-4 text-sm leading-6 text-secondary">{dict.portal.noDocuments}</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {rows.map((document) => (
                <li key={document.id} className="rounded-[10px] border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-navy">{dict.portal.docKinds[document.docType]}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_TONE[document.status])}>{dict.portal.docStatus[document.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{dict.portal.uploadedOn.replace('{date}', formatDate(document.createdAt, locale))}</p>
                  {document.reviewNote !== null && document.reviewNote !== '' ? (
                    <p className="mt-2 flex items-start gap-2 rounded-[8px] bg-rose-50 p-2.5 text-xs leading-5 text-rose-800">
                      <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {document.reviewNote}
                    </p>
                  ) : null}
                  {document.status === 'APPROVED' ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      {dict.portal.docApprovedNote}
                    </p>
                  ) : document.status === 'PENDING' ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {dict.portal.docPendingNote}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-5">
          <Card className="p-6">
            <h2 className="font-semibold text-navy">{dict.portal.cnicStatus}</h2>
            {cnic === undefined ? null : (
              <p
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-[9px] p-3 text-sm leading-6',
                  cnic.cnicVerified ? 'bg-emerald-50 text-emerald-800' : cnic.hasCnic ? 'bg-amber-50 text-amber-900' : 'bg-surface-2 text-secondary'
                )}
              >
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {cnic.cnicVerified ? dict.portal.cnicVerified : cnic.hasCnic ? dict.portal.cnicAwaiting : dict.portal.cnicMissing}
              </p>
            )}
            <p className="mt-4 text-xs leading-5 text-muted">{dict.portal.cnicPrivacyNote}</p>
          </Card>

          <Card className="p-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <FileUp className="size-4 text-muted" aria-hidden="true" />
              {dict.portal.submitDocument}
            </h2>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="doc-kind">{dict.portal.documentTypeLabel}</Label>
                <SelectField
                  id="doc-kind"
                  value={kind}
                  onChange={(value) => setKind(value as ProviderDocumentKind)}
                  options={KINDS.map((option) => ({ value: option, label: dict.portal.docKinds[option] }))}
                  placeholder={dict.portal.chooseDocument}
                />
              </div>

              {kind === 'CNIC_FRONT' || kind === 'CNIC_BACK' ? (
                <div className="grid gap-2">
                  <Label htmlFor="cnic-number">{dict.portal.cnicNumberLabel}</Label>
                  <Input id="cnic-number" value={cnicNumber} onChange={(event) => setCnicNumber(event.target.value)} placeholder={dict.portal.cnicNumberPlaceholder} />
                  <p className="text-xs leading-5 text-muted">{dict.portal.cnicNumberHint}</p>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="doc-file">{dict.portal.chooseFileLabel}</Label>
                <input id="doc-file" type="file" accept=".jpg,.jpeg,.png,.pdf" className="text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <p className="text-xs leading-5 text-muted">{dict.portal.fileTypesHint.replace('{max}', String(Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)))}</p>
              </div>

              {localError !== '' ? (
                <p role="alert" className="flex items-start gap-2 rounded-[9px] bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {localError}
                </p>
              ) : null}

              {done !== '' ? (
                <p role="status" className="rounded-[9px] bg-emerald-50 p-3 text-sm text-emerald-800">
                  {done}
                </p>
              ) : null}

              <Button type="button" onClick={() => void send()} disabled={busy || submit.isPending}>
                {busy || submit.isPending ? dict.portal.uploading : dict.portal.submitDocument}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export type { ProviderDocument };
