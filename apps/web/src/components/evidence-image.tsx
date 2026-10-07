"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A photo the API has stored, rendered from the `url` it returned.
 *
 * In production that URL points at object storage and serves the bytes, so it can
 * go straight into `src`. In development the storage adapter is a mock and its
 * `GET /dev/storage/:bucket/:key` answers with a JSON envelope —
 * `{ contentType, contentBase64 }` — rather than image bytes. Pointing an `<img>`
 * at that renders a broken image, which is what the booking page did until this
 * was added: the photos were on file and the grid showed five empty tiles.
 *
 * So the envelope is unwrapped here. A real object URL is left alone, and if the
 * fetch fails the tile says so rather than showing a broken-image glyph.
 */
export function EvidenceImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    /* Only the mock storage answers with an envelope. Anything else — a
       presigned or CDN URL — is already loadable and must not be fetched here,
       or the browser would download every photo twice. */
    if (!/\/dev\/storage\//.test(url)) {
      setResolved(url);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { contentType?: string; contentBase64?: string };
        if (typeof body.contentBase64 !== "string") throw new Error("no content");
        if (cancelled) return;
        setResolved(`data:${body.contentType ?? "image/jpeg"};base64,${body.contentBase64}`);
      } catch {
        /* An aborted request is not a failure to report. */
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  if (failed) {
    return (
      <span className={cn("grid h-full w-full place-items-center bg-slate-100 p-2 text-center text-[11px] leading-4 text-slate-500", className)}>
        Photo unavailable
      </span>
    );
  }

  if (resolved === null) return <span className={cn("block h-full w-full animate-pulse bg-slate-100", className)} aria-hidden="true" />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a runtime object URL or a data URL, neither of which next/image can optimise
    <img src={resolved} alt={alt} className={cn("size-full object-cover", className)} />
  );
}