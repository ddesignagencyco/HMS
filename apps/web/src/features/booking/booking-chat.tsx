"use client";

import { MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { cn, formatDateTime, type Locale } from "@/lib/utils";
import { Button, Card, Label, Textarea } from "@/components/ui";
import { canMessage } from "@/features/booking/status";
import { useBookingMessages, useSendMessage } from "@/features/booking/queries";
import type { Booking } from "@/features/booking/api";

/* FR-BK-07: the in-booking chat, with contact details masked on the way in.

   Two things about the endpoint shape this UI has to respect:

   · **Reading is not free.** `GET /bookings/:id/messages` marks the other side's
     unread messages as read, so it is never served from a cache and never
     polled — it is fetched when the thread is open and refetched after a send.

   · **`open` is authoritative, not derived.** The chat closes the moment the job
     leaves the two parties' hands, and the server decides that from the
     booking's status. This component renders a closed thread as closed, using
     the flag the API returned, rather than second-guessing it. Messages stay
     readable after it closes — that is deliberate on the server's side.

   The `masked` flag on a send is surfaced too: when the platform replaced a phone
   number with `[number hidden]`, the sender is told their message was altered
   rather than being left to wonder why it looks different. */

const POLL_MS = 15_000;

export function BookingChat({ locale, dict, booking }: { locale: Locale; dict: Dictionary; booking: Booking }) {
  const enabled = canMessage(booking.status);
  const thread = useBookingMessages(booking.id, locale, enabled);
  const send = useSendMessage(locale);
  const [draft, setDraft] = useState("");
  const [maskedNotice, setMaskedNotice] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  /* A modest interval rather than a window-focus refetch: the chat is the one
     place a customer expects a reply to appear while they are looking at it, but
     reading has a side effect, so it stays infrequent and only while open. */
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => void thread.refetch(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, thread]);

  /* Scroll to the newest message so a reply appears without the customer hunting
       for it. Guarded because `scrollIntoView` is absent in jsdom and in some
       older embedded webviews — an uncaught TypeError here would take the whole
       booking page down over a convenience. */
  useEffect(() => {
    const node = bottom.current;
    if (node !== null && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "end" });
  }, [thread.data?.items?.length]);

  if (!enabled) {
    return (
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <MessageSquare className="size-4 text-muted" aria-hidden="true" />
          {dict.booking.chatTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{dict.booking.chatClosed}</p>
      </Card>
    );
  }

  const items = thread.data?.items ?? [];

  const submit = async (): Promise<void> => {
    const body = draft.trim();
    if (body === "") return;
    setMaskedNotice("");
    try {
      const result = await send.mutateAsync({ id: booking.id, body });
      /* The server rewrites contact details before storing, so what comes back
         is what was actually recorded. Showing the sent text instead would let
         a customer believe a number reached the professional. */
      setDraft("");
      if (result.masked) setMaskedNotice(dict.booking.chatMaskedNotice);
    } catch {
      /* Left in the draft on purpose: the message was not sent, and losing the
         text somebody typed would be worse than showing the error. */
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <MessageSquare className="size-4 text-muted" aria-hidden="true" />
          {dict.booking.chatTitle}
        </h2>
        <p className="text-xs text-muted">{dict.booking.chatMaskedNote}</p>
      </div>

      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-[10px] bg-surface-2 p-3">
        {thread.isPending ? (
          <p className="text-sm text-secondary" aria-busy="true">{dict.booking.chatLoading}</p>
        ) : thread.isError ? (
          <p role="alert" className="text-sm text-rose-700">{dict.booking.chatError}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-secondary">{dict.booking.chatEmpty}</p>
        ) : (
          items.map((message) => (
            <div key={message.id} className={cn("flex flex-col", message.mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-[12px] px-3 py-2 text-sm leading-6",
                  message.mine ? "bg-primary text-white" : "bg-white text-navy",
                )}
              >
                {message.body}
              </div>
              <p className="mt-1 text-[11px] text-muted">{formatDateTime(message.createdAt, locale)}</p>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>

      {maskedNotice !== "" ? <p className="mt-3 rounded-[9px] bg-amber-50 p-3 text-xs leading-5 text-amber-900">{maskedNotice}</p> : null}

      <div className="mt-3 grid gap-2">
        <Label htmlFor="chat-body" className="sr-only">
          {dict.booking.chatInputLabel}
        </Label>
        <Textarea
          id="chat-body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={dict.booking.chatPlaceholder}
          rows={2}
          className="min-h-16"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        {send.isError ? <p role="alert" className="text-xs text-rose-700">{dict.booking.chatSendFailed}</p> : <span />}
        <Button type="button" size="sm" disabled={draft.trim() === "" || send.isPending} onClick={() => void submit()}>
          <Send className="size-4" aria-hidden="true" />
          {send.isPending ? dict.booking.working : dict.booking.chatSend}
        </Button>
      </div>
    </Card>
  );
}