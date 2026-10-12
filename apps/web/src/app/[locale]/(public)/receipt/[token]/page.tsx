import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReceiptComplaintForm } from "@/features/complaints/receipt-complaint-view";
import { pageMetadata } from "@/lib/seo";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* The "report a problem" link on a cash receipt.
 *
 * **The token in the URL is the credential.** `POST /complaints/from-receipt` is
 * `@Public()` precisely so this page works from an SMS receipt with no account —
 * a cash customer is the *least* likely person on the platform to be signed in,
 * which is why the signed-in complaint route was never enough for that payment
 * mode.
 *
 * Never indexed, and no canonical published: a working receipt link in a search
 * result is a working complaint link in a search result, and a cached canonical
 * would point every token at one URL. Same reasoning as
 * `app/[locale]/(public)/verification/[token]`.
 */
export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  const meta = pageMetadata(locale, "/receipt", dict.complaints.receiptTitle, dict.complaints.receiptText, {
    noindex: true
  });
  /* A token is not an address, so there is no canonical to declare. */
  return { ...meta, alternates: { canonical: undefined } };
}

export default async function ReceiptReportPage({
  params
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();

  /* A token too short to be one of ours is caught by the form itself and rendered
     as an unusable link, rather than 404-ing the route — the two are the same to
     the person holding the phone, and a 404 on a route that does exist is a
     broken link in their browser's eyes. */
  return <ReceiptComplaintForm locale={locale} dict={getDictionary(locale)} token={token} />;
}