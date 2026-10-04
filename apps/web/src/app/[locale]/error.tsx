"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-50 text-rose-700"><AlertTriangle className="size-6" /></span>
        <h1 className="mt-5 text-2xl font-semibold text-navy">We could not load this</h1>
        <p className="mt-2 text-sm text-secondary">Try again. If the problem continues, return to the homepage.</p>
        <button type="button" onClick={reset} className="mt-6 min-h-11 rounded-[9px] bg-primary px-5 text-sm font-semibold text-white">Try again</button>
      </div>
    </div>
  );
}
