"use client";

import { Bell, Check, CheckCheck, Clock, ExternalLink, Loader2, MessageSquare, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationApi } from "@/features/notifications/api";
import { useSession } from "@/features/auth/session";
import { cn, formatDate, localizedPath, type Locale } from "@/lib/utils";

type NotificationBellProps = {
  locale?: Locale;
  dark?: boolean;
  className?: string;
};

export function NotificationBell({ locale = "en", dark = false, className }: NotificationBellProps) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const isAuth = status === "authenticated";

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", "own"],
    queryFn: () => notificationApi.own({ locale, limit: 30 }),
    enabled: isAuth,
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id, { locale }),
    onSuccess: (_, id) => {
      queryClient.setQueryData<typeof data>(["notifications", "own"], (old) => {
        if (!old) return old;
        return {
          ...old,
          unreadCount: Math.max(0, old.unreadCount - 1),
          items: old.items.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["notifications", "own"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to mark notification read");
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead({ locale }),
    onSuccess: () => {
      queryClient.setQueryData<typeof data>(["notifications", "own"], (old) => {
        if (!old) return old;
        return {
          ...old,
          unreadCount: 0,
          items: old.items.map((item) => ({ ...item, readAt: new Date().toISOString() })),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["notifications", "own"] });
      toast.success(locale === "ur" ? "تمام اطلاعات پڑھ لی گئیں" : "All marked as read");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to mark all as read");
    },
  });

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!isAuth) {
    return null;
  }

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <div className={cn("relative inline-block", className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
        className={cn(
          "relative grid size-10 place-items-center rounded-[9px] transition-colors focus:outline-none focus:ring-2 focus:ring-primary",
          dark
            ? "border border-white/10 text-white/85 hover:bg-white/10 hover:text-white"
            : "border border-line text-navy hover:bg-slate-50"
        )}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notification Center"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 sm:w-96 rounded-[14px] border border-line bg-white shadow-lifted"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-navy text-sm">
                {locale === "ur" ? "اطلاعات" : "Notifications"}
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  {unreadCount} {locale === "ur" ? "نئی" : "new"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={markAllReadMutation.isPending}
                  onClick={() => markAllReadMutation.mutate()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-strong hover:underline disabled:opacity-50"
                  title="Mark all as read"
                >
                  <CheckCheck className="size-3.5" />
                  <span>{locale === "ur" ? "سب پڑھا ہوا نشان زد کریں" : "Mark all read"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted hover:bg-slate-100 hover:text-navy"
                aria-label="Close notifications"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-line">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-xs text-muted">
                <Loader2 className="mr-2 size-4 animate-spin text-primary" />
                {locale === "ur" ? "اطلاعات لوڈ ہو رہی ہیں..." : "Loading notifications..."}
              </div>
            ) : isError ? (
              <div className="p-6 text-center text-xs text-rose-600">
                <p>Failed to load notifications</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-2 rounded bg-slate-100 px-2.5 py-1 font-semibold text-navy hover:bg-slate-200"
                >
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">
                <Bell className="mx-auto mb-2 size-6 text-slate-300" />
                <p className="font-medium text-navy">{locale === "ur" ? "کوئی نئی اطلاع نہیں" : "No notifications"}</p>
                <p className="mt-0.5 text-[11px]">{locale === "ur" ? "آپ کے پاس تمام اطلاعات دیکھی جا چکی ہیں" : "You are all caught up!"}</p>
              </div>
            ) : (
              items.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-3 p-3.5 text-xs transition-colors",
                      isUnread ? "bg-blue-50/40 hover:bg-blue-50/60" : "hover:bg-slate-50"
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {item.eventKey.includes("complaint") ? (
                        <div className="grid size-7 place-items-center rounded-full bg-rose-100 text-rose-700">
                          <ShieldAlert className="size-3.5" />
                        </div>
                      ) : item.eventKey.includes("booking") ? (
                        <div className="grid size-7 place-items-center rounded-full bg-blue-100 text-primary-strong">
                          <Clock className="size-3.5" />
                        </div>
                      ) : (
                        <div className="grid size-7 place-items-center rounded-full bg-slate-100 text-slate-700">
                          <MessageSquare className="size-3.5" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      {item.subject && (
                        <p className={cn("font-semibold text-navy", isUnread && "font-bold")}>
                          {item.subject}
                        </p>
                      )}
                      <p className="mt-0.5 leading-relaxed text-secondary text-xs break-words">
                        {item.body}
                      </p>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
                        <span>{formatDate(item.createdAt, locale)}</span>
                        {item.bookingId && (
                          <Link
                            href={localizedPath(locale, `/account/bookings/${item.bookingId}`)}
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-0.5 text-primary-strong hover:underline"
                          >
                            <span>{locale === "ur" ? "بکنگ دیکھیں" : "View booking"}</span>
                            <ExternalLink className="size-2.5" />
                          </Link>
                        )}
                      </div>
                    </div>

                    {isUnread && (
                      <button
                        type="button"
                        disabled={markReadMutation.isPending}
                        onClick={() => markReadMutation.mutate(item.id)}
                        className="shrink-0 rounded p-1 text-muted hover:bg-white hover:text-navy"
                        title={locale === "ur" ? "پڑھا ہوا نشان لگائیں" : "Mark as read"}
                      >
                        <Check className="size-3.5 text-primary" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
