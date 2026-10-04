import toast from "react-hot-toast";
import type { UseFormSetError } from "react-hook-form";
import { ApiError, NetworkError } from "@/lib/api/problem";
import type { Dictionary } from "@/lib/dictionaries";

/* Toasts carry the one message a field cannot: something that is wrong with the
   request rather than with a particular input. Validation stays inline, the API
   client never toasts, and only the caller that knows whether the failure is
   worth interrupting for calls this — so a background refetch or a cancelled
   request stays silent. */

/** The server's own detail, or a locale fallback when it has none. */
export const detailOf = (error: unknown, dict: Dictionary): string => {
  if (error instanceof ApiError) return error.problem.detail;
  if (error instanceof NetworkError) return dict.auth.networkError;
  return dict.auth.genericError;
};

/**
 * Puts a 422's field errors on the inputs they belong to. The API's paths are
 * the same names the schemas use (`password`, `phoneE164`, `code`), so a server
 * message lands under the control the person is looking at.
 */
export const applyServerFieldErrors = <T extends Record<string, unknown>>(
  form: { setError: UseFormSetError<T> },
  error: unknown,
): void => {
  if (!(error instanceof ApiError)) return;
  for (const [field, message] of Object.entries(error.fieldErrors)) {
    form.setError(field as never, { type: "server", message });
  }
};

/**
 * The message for a failed request, without raising a toast.
 *
 * Every authentication form has a summary region that carries the message and
 * announces it with role="alert", so toasting the same sentence as well would
 * show the failure twice and read it out twice.
 */
export const authErrorMessage = (error: unknown, dict: Dictionary): string => detailOf(error, dict);

/**
 * For a failure with nowhere to show inline. Returns the message so a caller
 * that does have a region can still place it.
 */
export const reportAuthError = (error: unknown, dict: Dictionary, scope: string): string => {
  const detail = detailOf(error, dict);
  toast.error(detail, { id: `auth:${scope}` });
  return detail;
};

/** Only ever called after the server has confirmed the change. */
export const toastSuccess = (message: string): void => {
  toast.success(message);
};

/** Displays an error toast message using react-hot-toast. */
export const toastError = (message: string, id?: string): void => {
  toast.error(message, id ? { id } : undefined);
};

/** Displays an informational toast message using react-hot-toast. */
export const toastInfo = (message: string, id?: string): void => {
  toast(message, {
    id,
    icon: "ℹ️",
  });
};