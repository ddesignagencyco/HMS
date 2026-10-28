"use client";

/* `/receipt/[token]/report` — raising a complaint from a cash receipt, with no
 * account.
 *
 * **This page closed a hole in the cash flow.** Cash jobs settle against an SMS
 * receipt with a "report a problem" link on it, and that link went nowhere: there
 * was no route for it, so the one payment mode where the customer is *least*
 * likely to be signed in had no way to complain at all. `POST
 * /complaints/from-receipt` is `@Public()` and exists for exactly this.
 *
 * What makes it safe without a session, and what this screen therefore never
 * does:
 *
 * · **The token is the proof.** `readReceiptToken` resolves it to a booking id, and
 *   a token the platform did not issue is a 404 indistinguishable from a
 *   nonexistent booking. So a bad token says "this link is not valid" and nothing
 *   more — **never** which booking it might have been, because that difference
 *   would confirm a booking exists to somebody iterating tokens.
 *
 * · **The token is never displayed back, never put in a query string, and never
 *   sent anywhere except this one POST.** It is read from the path segment, held
 *   in component state, and dropped when the page is left.
 *
 * · **`auth: false` on the call.** A stale bearer token must not turn an anonymous
 *   complaint into one attributed to whoever happens to be signed in on this
 *   browser.
 *
 * The categories offered are the **customer-facing half** of the enum, for the
 * same reason the signed-in form offers only those three urgent cases are
 * highlighted: `NON_PAYMENT`, `UNSAFE_PREMISES` and `ABUSE` exist in the enum
 * because a provider raises them against a customer, and the schema accepts them
 * from either side.
 */

import { Camera, CheckCircle2, Loader2, ShieldAlert, AlertTriangle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button, Card, Label, PageHeader, Textarea } from "@/components/ui";
import { SelectField } from "@/components/select-field";
import {
  complaintsApi,
  CUSTOMER_CATEGORIES,
  isPlausibleReceiptToken,
  MAX_COMPLAINT_DESCRIPTION,
  MAX_COMPLAINT_PHOTOS,
  MAX_RECEIPT_TOKEN_LENGTH,
  MIN_COMPLAINT_DESCRIPTION,
  type ComplaintCategory,
  type ComplaintPhotoInput,
} from "@/features/complaints/api";
import type { Dictionary } from "@/lib/dictionaries";
import { formatNumber, type Locale } from "@/lib/utils";

/** `complaints.schemas.ts` caps evidence at five, on this route as on the signed-in one. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    /* The data URL prefix is stripped: the schema wants raw base64, and sending
       `data:image/jpeg;base64,...` is a 422. */
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected read result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });

export function ReceiptComplaintForm({ locale, dict, token }: { locale: Locale; dict: Dictionary; token: string }) {
  const plausible = isPlausibleReceiptToken(token);
  const [category, setCategory] = useState<ComplaintCategory | "">("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ComplaintPhotoInput[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string; severity: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const send = useMutation({
    mutationFn: () =>
      complaintsApi.createFromReceipt(
        {
          token,
          category: category as ComplaintCategory,
          description: description.trim(),
          ...(photos.length === 0 ? {} : { photos })
        },
        { locale }
      ),
    onSuccess: (result) => setSubmitted(result),
    retry: false
  });

  /* ---- photos ---- */

  const onFiles = async (files: FileList | null) => {
    setFileError(null);
    if (files === null) return;

    const room = MAX_COMPLAINT_PHOTOS - photos.length;
    if (room <= 0) {
      setFileError(dict.complaints.photoLimitReached);
      return;
    }

    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setFileError(dict.complaints.photoTruncated.replace("{count}", formatNumber(room, locale)));

    const accepted: ComplaintPhotoInput[] = [];
    for (const file of chosen) {
      /* The same three types `photo` allows. A rejected file is skipped with a
         reason rather than silently dropped — somebody who photographed the
         problem and watched it vanish has been told nothing went wrong. */
      if (file.type !== "image/jpeg" && file.type !== "image/png" && file.type !== "image/webp") {
        setFileError(dict.complaints.photoTypeRejected);
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setFileError(dict.complaints.photoTooLarge);
        continue;
      }
      try {
        accepted.push({ contentType: file.type as ComplaintPhotoInput["contentType"], contentBase64: await readAsBase64(file) });
      } catch {
        setFileError(dict.complaints.photoUnreadable);
      }
    }

    if (accepted.length > 0) setPhotos((current) => [...current, ...accepted]);
    if (fileInput.current !== null) fileInput.current.value = "";
  };

  /* ---- validation ---- */

  const descriptionLength = description.trim().length;
  const descriptionValid = descriptionLength >= MIN_COMPLAINT_DESCRIPTION;
  const overLimit = descriptionLength > MAX_COMPLAINT_DESCRIPTION;
  const canSend = plausible && category !== "" && descriptionValid && !overLimit && !send.isPending;

  /* ---- an unusable token ---- */

  if (!plausible) {
    return (
      <div>
        <PageHeader eyebrow={dict.brand.name} title={dict.complaints.receiptTitle} description={dict.complaints.receiptText} />
        <div role="alert" className="mt-6 rounded-[14px] border border-amber-200 bg-amber-50 p-6">
          <p className="flex items-start gap-2 text-sm font-medium leading-6 text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {dict.complaints.receiptTokenMalformed}
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-800">{dict.complaints.receiptTokenMalformedText}</p>
        </div>
      </div>
    );
  }

  /* ---- sent ---- */

  if (submitted !== null) {
    return (
      <div>
        <PageHeader eyebrow={dict.brand.name} title={dict.complaints.receiptTitle} description={dict.complaints.receiptText} />
        <Card className="mt-6 border-emerald-200 bg-emerald-50 p-6">
          <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {dict.complaints.receiptSent}
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-800">{dict.complaints.receiptSentText}</p>
          <p className="mt-4 rounded-[9px] border border-emerald-200 bg-white p-4">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
              {dict.complaints.receiptReference}
            </span>
            <span className="mt-1 block font-mono text-sm text-navy">{submitted.id}</span>
          </p>
          <p className="mt-3 text-xs leading-5 text-emerald-800">{dict.complaints.receiptKeepReference}</p>
        </Card>
      </div>
    );
  }

  /* ---- the form ---- */

  const field =
    "mt-1.5 w-full rounded-[9px] border border-line bg-white px-3 py-2.5 text-sm text-navy outline-none focus:border-primary focus:ring-4 focus:ring-blue-100";

  return (
    <div>
      <PageHeader eyebrow={dict.brand.name} title={dict.complaints.receiptTitle} description={dict.complaints.receiptText} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5">
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) send.mutate();
            }}
          >
            <div>
              <Label htmlFor="receipt-category">{dict.complaints.category}</Label>
              <SelectField
                id="receipt-category"
                value={category}
                onChange={(val) => setCategory(val as ComplaintCategory | "")}
                options={CUSTOMER_CATEGORIES.map((value) => ({
                  value,
                  label: (dict as Dictionary & { complaintCategories: Record<string, string> }).complaintCategories[value] ?? value,
                }))}
                placeholder={dict.complaints.chooseCategory}
              />
              {category === "SAFETY" ? (
                <p className="mt-1.5 text-xs font-medium leading-5 text-rose-700">{dict.complaints.urgentSafety}</p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="receipt-description">{dict.complaints.whatHappened}</Label>
              <Textarea
                id="receipt-description"
                rows={6}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                aria-describedby="receipt-description-count"
                className={field}
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p
                  id="receipt-description-count"
                  className={`text-xs ${overLimit ? "font-semibold text-rose-700" : "text-muted"}`}
                >
                  {overLimit
                    ? dict.complaints.tooLong
                    : dict.complaints.minimumHint.replace("{min}", formatNumber(MIN_COMPLAINT_DESCRIPTION, locale))}
                </p>
                <p className="text-xs text-muted tabular-nums">
                  {formatNumber(descriptionLength, locale)} / {formatNumber(MAX_COMPLAINT_DESCRIPTION, locale)}
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="receipt-photos">{dict.complaints.photosOptional}</Label>
              <input
                ref={fileInput}
                id="receipt-photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={photos.length >= MAX_COMPLAINT_PHOTOS}
                onChange={(event) => void onFiles(event.target.files)}
                className="mt-1.5 block w-full text-sm text-secondary file:me-3 file:rounded-[9px] file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-navy"
              />
              <p className="mt-1.5 text-xs text-muted">
                {dict.complaints.photoCount
                  .replace("{count}", formatNumber(photos.length, locale))
                  .replace("{max}", formatNumber(MAX_COMPLAINT_PHOTOS, locale))}
              </p>
              {photos.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {photos.map((photo, index) => (
                    <li key={`${photo.contentBase64.length}-${index}`}>
                      <button
                        type="button"
                        onClick={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Camera className="size-3" aria-hidden="true" />
                        {dict.complaints.removePhoto.replace("{index}", formatNumber(index + 1, locale))}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {fileError !== null ? (
                <p role="alert" className="mt-2 text-xs leading-5 text-amber-700">
                  {fileError}
                </p>
              ) : null}
            </div>

            {send.isError ? (
              <div role="alert" className="rounded-[9px] border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-medium leading-6 text-rose-800">
                  {send.error instanceof Error ? send.error.message : dict.complaints.receiptFailed}
                </p>
                {/* A 404 here is the answer for an unknown token and a missing
                    booking alike, and the server will not say which. Retrying will
                    not help, so the screen offers the route that will. */}
                {(send.error as { status?: number } | undefined)?.status === 404 ? (
                  <p className="mt-2 text-xs leading-5 text-rose-700">{dict.complaints.receiptInvalidLink}</p>
                ) : null}
              </div>
            ) : null}

            <div>
              <Button type="submit" disabled={!canSend}>
                {send.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
                {send.isPending ? dict.complaints.sending : dict.complaints.receiptSubmit}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-navy">{dict.complaints.receiptWhatNext}</h2>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-secondary">
            <li>1. {dict.complaints.receiptStep1}</li>
            <li>2. {dict.complaints.receiptStep2}</li>
            <li>3. {dict.complaints.receiptStep3}</li>
          </ol>
          <p className="mt-4 rounded-[9px] border border-line bg-slate-50 p-3 text-xs leading-5 text-muted">
            {dict.complaints.receiptPrivacy}
          </p>
        </Card>
      </div>
    </div>
  );
}

/** Exposed so the page can say whether a token is worth rendering a form at all. */
export const isReceiptTokenRenderable = isPlausibleReceiptToken;

/** The bound the schema enforces, for the page's own guard message. */
export const RECEIPT_TOKEN_MAX_LENGTH = MAX_RECEIPT_TOKEN_LENGTH;