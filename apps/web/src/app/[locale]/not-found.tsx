"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, localizedPath } from "@/lib/utils";

export default function NotFound() {
  /* not-found.tsx receives no params, so the locale is read back off the path
     the visitor actually asked for. Anything unrecognised falls back to
     English rather than throwing a second error on the error page. */
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const locale = isLocale(segment) ? segment : "en";
  const dict = getDictionary(locale);

  return (
    <div className="relative grid min-h-screen place-items-center overflow-x-clip bg-navy-950 p-6 text-center">
      <div className="relative">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-yellow-500">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white">{dict.common.notFound}</h1>
        <p className="mt-3 text-sm text-white/70">{dict.common.notFoundText}</p>
        <Link
          href={localizedPath(locale)}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-yellow-500 px-5 text-sm font-semibold text-navy-950 transition-colors hover:bg-yellow-400"
        >
          {dict.common.backHome}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
