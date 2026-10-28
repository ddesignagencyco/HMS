/* The gateway link for an unpaid online booking.

   `POST /bookings` returns `payment.redirectUrl` exactly once, and there is no
   endpoint to ask for it again (backend_requirement.md §2.3). So the client keeps
   it, keyed by booking id, for as long as the booking is PENDING_PAYMENT.

   localStorage rather than sessionStorage: a customer who opens the booking in a
   new tab — from the bookings list, or from a notification — must still be able to
   pay. Every access is wrapped: private mode and blocked storage throw, and a
   missing link is a state the screens already handle. */

const keyFor = (bookingId: string) => `booking:paymentUrl:${bookingId}`;

export const savePaymentLink = (bookingId: string, redirectUrl: string): void => {
  try {
    window.localStorage.setItem(keyFor(bookingId), redirectUrl);
  } catch {
    /* Storage unavailable — this tab still has the link on screen. */
  }
};

export const readPaymentLink = (bookingId: string): string | null => {
  try {
    return window.localStorage.getItem(keyFor(bookingId)) ?? window.sessionStorage.getItem(keyFor(bookingId));
  } catch {
    return null;
  }
};

/** Once the booking has left PENDING_PAYMENT the link is spent. */
export const clearPaymentLink = (bookingId: string): void => {
  try {
    window.localStorage.removeItem(keyFor(bookingId));
    window.sessionStorage.removeItem(keyFor(bookingId));
  } catch {
    /* Nothing to clear. */
  }
};
