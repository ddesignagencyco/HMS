import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { VerificationFlow } from "@/features/verification/verification-flow";
import { verificationApi, type VerificationLink } from "@/features/verification/api";
import { pageMetadata } from "@/lib/seo";
import { ApiError } from "@/lib/api/problem";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale } from "@/lib/utils";

/* The customer's one-tap verification link, opened from an SMS.

   The token in the URL is the credential — the API route is `@Public()` and this
   page is reachable without a session, which is the point of a link sent by SMS.

   The link is read on the server so the first paint already knows which job it
   is, and so a 404 or a 410 is a real state rather than a flash of a form that
   cannot work. It used to look the booking up in `src/lib/data.ts` by a `?code=`
   query parameter and render that, then set a local "thank you" flag on submit
   without calling anything: a customer confirming a job was told it had been
   recorded when no record existed. */

/**
 * Never indexed, and no canonical URL published for it.
 *
 * The token in the path is the credential: the API route behind this page is
 * `@Public()` precisely so the link works from an SMS with no session. Indexing
 * one would put a working one-tap verification link into a search result, where
 * it would be fetched, cached and forwarded by anybody who found it — and a
 * cached canonical would point every token at the same URL.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; token: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  const meta = pageMetadata(locale, "/verification", dict.verifyPage.titleLead, dict.verifyPage.description, { noindex: true });
  /* A token is not a page address, so there is nothing to declare canonical. */
  return { ...meta, alternates: { canonical: undefined } };
}

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();

  let link: VerificationLink | null = null;
  let expired = false;
  let loadError: string | null = null;
  let loading = false;

  try {
    link = await verificationApi.describe(token, { locale });
  } catch (error) {
    /* 410 GONE is expired-or-already-used and 404 is unknown; both are the same
       thing to the person holding the phone. The server's `detail` is shown when
       it gives one, because "this link has already been used" is more useful
       than a generic message. */
    if (error instanceof ApiError) {
      expired = true;
      loadError = error.problem.detail || null;
    } else {
      /* A transport fault is not an expired link, so it is surfaced as an error
         rather than being reported as a dead token. */
      loading = false;
      loadError = null;
      link = null;
      expired = false;
      loadError = error instanceof Error ? error.message : null;
    }
  }

  return (
    <VerificationFlow
      locale={locale}
      dict={getDictionary(locale)}
      token={token}
      link={link}
      expired={expired}
      loading={loading}
      loadError={loadError}
    />
  );
}