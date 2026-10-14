"use client";

import { FileText, ImageOff, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn } from "@/lib/utils";

/* A file the API has stored — a job photo, a complaint attachment, a provider
   document — rendered from the URL the API handed back.

   Two kinds of URL reach this component:

   · **A real object URL.** With `STORAGE_PROVIDER=supabase` the API signs a
     short-lived Supabase Storage link (`…supabase.co/storage/v1/object/sign/…`)
     that serves the bytes directly, so it goes straight into `src`. Fetching it
     here first would download every file twice.
   · **The dev mock's envelope.** With `STORAGE_PROVIDER=mock`, `GET
     /dev/storage/:bucket/:key` answers JSON — `{ contentType, contentBase64 }` —
     not bytes, so it is unwrapped into a data URL. This is the only case that
     waits on a request.

   Since the Supabase switch the API also accepts GIF, MP4/WebM/QuickTime video
   and PDF as evidence and documents (`evidenceContentTypes`,
   `documentContentTypes`). An `<img>` pointed at a video or a PDF is a broken
   tile, so the element is chosen from the content type: the row's own
   `contentType` when the caller has it, the envelope's when unwrapped, and the
   URL's extension as a last resort. */

export type MediaKind = "image" | "video" | "pdf";

export const mediaKindOf = (contentType: string | null | undefined, url?: string): MediaKind => {
  if (contentType?.startsWith("video/")) return "video";
  if (contentType === "application/pdf") return "pdf";
  if (contentType?.startsWith("image/")) return "image";
  const path = (url ?? "").split("?")[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov|qt)$/.test(path)) return "video";
  if (path.endsWith(".pdf")) return "pdf";
  return "image";
};

/** The mock adapter's route. Anything else is treated as a loadable object URL. */
export const isDevStorageUrl = (url: string): boolean => /\/dev\/storage\//.test(url);

export type MediaLabels = {
  /** Shown when the file cannot be loaded — missing, or a signed link that expired. */
  unavailable: string;
  /** The link text on a PDF tile. */
  openPdf: string;
};

const DEFAULT_LABELS: MediaLabels = { unavailable: "File unavailable", openPdf: "Open PDF" };

/** The localized labels, from the dictionary every screen already holds. */
export const mediaLabels = (dict: Dictionary): MediaLabels => ({ unavailable: dict.common.mediaUnavailable, openPdf: dict.common.openPdf });

export function StoredMedia({
  url,
  alt,
  contentType,
  className,
  labels = DEFAULT_LABELS,
  controls = false
}: {
  url: string;
  alt: string;
  /** The stored file's type, when the API returned it alongside the URL. */
  contentType?: string | null;
  className?: string;
  labels?: MediaLabels;
  /** Video only: full player controls. Thumbnails stay muted and inert. */
  controls?: boolean;
}) {
  const isEnvelope = isDevStorageUrl(url);

  const [unwrapped, setUnwrapped] = useState<{ url: string; data: string; contentType: string } | null>(null);
  /* Keyed by URL so a re-signed link (a refetch after expiry) gets a fresh try
     rather than inheriting the failure of the link it replaced. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isEnvelope) return;

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: "same-origin", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { contentType?: string; contentBase64?: string };
        if (typeof body.contentBase64 !== "string") throw new Error("no content");
        if (cancelled) return;
        const type = body.contentType ?? contentType ?? "image/jpeg";
        setUnwrapped({ url, data: `data:${type};base64,${body.contentBase64}`, contentType: type });
      } catch {
        /* An aborted request is not a failure to report. */
        if (!cancelled) setFailedUrl(url);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, isEnvelope, contentType]);

  if (failedUrl === url) {
    return (
      <span role="img" aria-label={alt || labels.unavailable} className={cn("grid h-full w-full place-items-center gap-1 bg-slate-100 p-2 text-center text-[11px] leading-4 text-slate-500", className)}>
        <ImageOff className="mx-auto size-4" aria-hidden="true" />
        {labels.unavailable}
      </span>
    );
  }

  /* Real URL: ready now. Envelope: ready only once *this* url has been unwrapped. */
  const decoded = unwrapped !== null && unwrapped.url === url ? unwrapped : null;
  const src = isEnvelope ? decoded?.data ?? null : url;
  if (src === null) return <span className={cn("block h-full w-full animate-pulse bg-slate-100", className)} aria-hidden="true" />;

  const kind = mediaKindOf(decoded?.contentType ?? contentType, url);

  if (kind === "pdf") {
    /* Browsers will not render a PDF in an <img>, and an inline viewer in a
       thumbnail grid is unusable — a tile that opens it is what works. A data
       URL cannot be opened in a new tab in most browsers, so the envelope case
       is downloaded instead. */
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        {...(isEnvelope ? { download: `${alt || "document"}.pdf` } : {})}
        className={cn("grid h-full w-full place-items-center gap-1 bg-slate-50 p-2 text-center text-xs font-semibold text-primary-strong hover:bg-blue-50", className)}
      >
        <FileText className="mx-auto size-6" aria-hidden="true" />
        <span>{labels.openPdf}</span>
      </a>
    );
  }

  if (kind === "video") {
    return (
      <span className={cn("relative block h-full w-full bg-slate-900", className)}>
        <video
          src={src}
          aria-label={alt}
          className="size-full object-cover"
          preload="metadata"
          playsInline
          muted={!controls}
          controls={controls}
          onError={() => setFailedUrl(url)}
        />
        {!controls ? (
          <PlayCircle className="pointer-events-none absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-white/90 drop-shadow" aria-hidden="true" />
        ) : null}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a signed object URL or a data URL, neither of which next/image can optimise
    <img src={src} alt={alt} className={cn("size-full object-cover", className)} onError={() => setFailedUrl(url)} />
  );
}

/** The original name, kept so existing call sites read the same. */
export const EvidenceImage = StoredMedia;
