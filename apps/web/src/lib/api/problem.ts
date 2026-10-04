/* The RFC 9457 problem document the API answers every failure with, narrowed to
   the codes the identity surface can actually return. Mirrors
   packages/contracts/src/problem.ts and src/errors.ts. */

export type FieldError = { path: string; code: string; message: string };

export type ProblemCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "OTP_INVALID"
  | "OTP_LOCKED"
  | "INVALID_CREDENTIALS"
  | "REFRESH_REUSE_DETECTED"
  | "TOTP_REQUIRED"
  | "TOTP_INVALID"
  | "INTERNAL_ERROR";

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail: string;
  instance?: string;
  requestId?: string;
  errors: FieldError[];
};

export const isProblem = (value: unknown): value is Problem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Problem).code === "string" &&
  typeof (value as Problem).detail === "string" &&
  Array.isArray((value as Problem).errors);

/** Codes that mean "the access token is gone" rather than "you typed it wrong". */
export const EXPIRED_SESSION_CODES: readonly ProblemCode[] = ["UNAUTHENTICATED", "REFRESH_REUSE_DETECTED"];

export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail);
    this.name = "ApiError";
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): ProblemCode {
    return this.problem.code;
  }

  get requestId(): string | undefined {
    return this.problem.requestId;
  }

  /** Field errors keyed by the name of the input they belong to. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const error of this.problem.errors) {
      if (error.path === "(root)") continue;
      if (out[error.path] === undefined) out[error.path] = error.message;
    }
    return out;
  }
}

/** A transport failure that never reached the API: offline, DNS, aborted. */
export class NetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";