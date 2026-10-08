import { apiRequest } from "@/lib/api/client";
import type { Locale } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  eventKey: string;
  subject: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
  bookingId: string | null;
  complaintId: string | null;
};

export type NotificationListResponse = {
  unreadCount: number;
  items: NotificationItem[];
};

export const notificationApi = {
  /**
   * `GET /notifications`
   * Fetch in-app notifications with unread count.
   */
  own: (options?: { unreadOnly?: boolean; limit?: number; locale?: Locale; signal?: AbortSignal }) =>
    apiRequest<NotificationListResponse>("/notifications", {
      method: "GET",
      query: {
        ...(options?.unreadOnly ? { unread: "true" } : {}),
        limit: options?.limit ?? 30,
      },
      locale: options?.locale,
      signal: options?.signal,
    }),

  /**
   * `POST /notifications/:id/read`
   * Mark an in-app notification as read.
   */
  markRead: (id: string, options?: { locale?: Locale }) =>
    apiRequest<{ id: string; read: boolean }>(`/notifications/${id}/read`, {
      method: "POST",
      locale: options?.locale,
    }),

  /**
   * `POST /notifications/read-all`
   * Mark all unread in-app notifications as read.
   */
  markAllRead: (options?: { locale?: Locale }) =>
    apiRequest<{ marked: number }>("/notifications/read-all", {
      method: "POST",
      locale: options?.locale,
    }),
};
