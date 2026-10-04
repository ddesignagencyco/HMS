"use client";

import { AlertTriangle, RefreshCw, SearchX } from "lucide-react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

/* The states a data-backed public page has to tell apart, so a genuine empty
   result is never mistaken for a failure and neither is mistaken for content.
   They are deliberately inline and local: an ordinary fetch failure does not
   warrant a toast, and the retry is right there. */

export function LoadingSkeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton block rounded-[10px]", className)} />;
}

export function InlineError({
  title,
  actionLabel,
  onRetry,
  className,
}: {
  title: string;
  actionLabel: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("rounded-[14px] border border-rose-200 bg-rose-50 p-5", className)}>
      <p className="flex items-start gap-2.5 text-sm font-medium leading-6 text-rose-800">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      {onRetry !== undefined ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry} className="mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border border-line bg-white p-8 text-center", className)}>
      {icon !== undefined ? <div className="mb-3 flex justify-center text-slate-300">{icon}</div> : null}
      <p className="text-base font-semibold tracking-[-0.02em] text-navy">{title}</p>
      {body !== undefined ? <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-secondary">{body}</p> : null}
      {action !== undefined ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function NotFoundState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <EmptyState title={title} body={body} action={action} icon={<SearchX className="size-8" aria-hidden="true" />} />;
}

/** A quiet marker while cached data is being re-read, so nothing jumps. */
export function RefreshingNote({ dict }: { dict: Dictionary }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
      {dict.catalogue.refresh}
    </p>
  );
}