"use client";

/* The live operations board — `GET /admin/ops-board` plus `…/stream`.
 *
 * **The old board computed its own numbers.** It counted rows out of the
 * complaints, disputes and penalties queues and put the result on tiles, which
 * was honest about being a count of rows it held and useless as an operations
 * board: no bookings, no queue depth, no SLA count, no escrow, and a hard 200-row
 * ceiling on every figure it showed.
 *
 * `OpsBoardService` answers all of that properly — every number queried from the
 * table it describes, recomputed on a shared five-second cadence and pushed over
 * Server-Sent Events. Two things about that shape the implementation:
 *
 * · **The stream cannot go through `EventSource`.** The route is
 *   `totpRequired`, and `EventSource` cannot send an `Authorization` header, so
 *   the connection is opened with `fetch` and read as a `ReadableStream`. That
 *   also means the SSE framing is parsed here rather than by the browser.
 *
 * · **The first snapshot comes from the REST call, not the stream.** Rendering
 *   nothing until a socket opens would leave the board blank on a flaky network
 *   for no reason — `GET /admin/ops-board` is one cached read. The stream then
 *   takes over. When the stream drops, the last snapshot stays on screen and is
 *   marked stale rather than being blanked: an operator deciding whether to act
 *   on a number needs to know whether that number is live.
 */

import { Activity, CircleDot, Gauge, Pause, Play, RefreshCcw, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import { adminApi, OPS_BOARD_STREAM_PATH, type OpsBoard } from "@/features/admin/api";
import { API_BASE, refreshSession } from "@/lib/api/client";
import { readAccessToken } from "@/lib/api/access-token";
import { adminKeys, FRESHNESS, publicRetry } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { formatDateTime, formatMoney, formatNumber, type Locale } from "@/lib/utils";

/* ---- paisa ------------------------------------------------------------ */

/**
 * `escrow.heldPaisa` is a **string of paisa**, because it is a Postgres int8
 * passed straight through (`ops-board.service.ts:137`).
 *
 * Returning null for anything unparseable rather than `0` matters here more than
 * usual: on this board a wrong escrow figure is a real balance, and "PKR 0.00"
 * would be read as "the platform is holding nothing" rather than "this number
 * could not be read".
 */
const escrowPaisa = (board: OpsBoard): number | null => {
  const paisa = Number(board.escrow.heldPaisa);
  return Number.isSafeInteger(paisa) ? paisa : null;
};

/* ---- the snapshot ----------------------------------------------------- */

/**
 * The REST read, used as the first paint and as the fallback whenever the stream
 * is not connected.
 *
 * Server-side cached for fifteen seconds and recomputed every five, so this is
 * cheap — but it is still only fetched once per mount and on an explicit
 * refresh, because the stream is what keeps the screen current.
 */
export function useOpsBoard(locale: Locale) {
  return useQuery({
    queryKey: adminKeys.opsBoard,
    queryFn: ({ signal }) => adminApi.opsBoard({ signal, locale }),
    staleTime: FRESHNESS.opsBoard.staleTime,
    gcTime: FRESHNESS.opsBoard.gcTime,
    /* With the stream off, the REST read is what keeps the board current. The
       server caches it for 15 s, so polling at that cadence costs one cached read. */
    refetchInterval: LIVE_STREAM_AVAILABLE ? false : 15_000,
    retry: publicRetry
  });
}

/**
 * Whether `GET /admin/ops-board/stream` may be opened.
 *
 * **Off until the backend fixes BE-016.** The controller combines `@Sse` with
 * `@Res()`; Nest's SSE timer then writes headers on a response the handler has
 * already started, throwing `ERR_HTTP_HEADERS_SENT` — uncaught, which **kills
 * the whole API process**. Reproduced 2026-10-14: opening this board took the
 * API down twice. Until the route is fixed the board polls the plain REST read
 * instead, which shows the same snapshot at most 15 s late. Flip to `true` once
 * BE-016 ships; nothing else needs to change.
 */
export const LIVE_STREAM_AVAILABLE = false;

/* ---- the stream ------------------------------------------------------- */

type StreamState = "connecting" | "live" | "off";

/**
 * Subscribes to the board's SSE feed.
 *
 * Returns the newest board the server has pushed, plus whether the connection is
 * actually live. The pushed value is kept separate from the REST value so the
 * screen can keep the last good snapshot on screen through a dropped connection
 * instead of flashing back to nothing.
 *
 * **The reconnect is deliberately not automatic.** An operations board that
 * reconnects forever, silently, is a board whose staleness nobody can see. A
 * dropped connection is surfaced as `off` with the last snapshot still shown and
 * its age on screen, and reconnecting is a deliberate press. The one exception is
 * unmount, which aborts the in-flight read so a closed tab does not keep a
 * connection alive.
 */
function useOpsBoardStream(locale: Locale, enabled: boolean): { board: OpsBoard | null; state: StreamState; reconnect: () => void } {
  const [board, setBoard] = useState<OpsBoard | null>(null);
  const [state, setState] = useState<StreamState>("connecting");
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    let cancelled = false;

    const run = async (): Promise<void> => {
      setState("connecting");
      /* Headers are rebuilt per request so a retry after a refresh carries the
         new access token rather than the expired one. */
      const open = (): Promise<Response> => {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (locale !== undefined) headers["accept-language"] = locale;
        const token = readAccessToken();
        if (token !== null) headers.authorization = `Bearer ${token}`;
        return fetch(`${API_BASE}${OPS_BOARD_STREAM_PATH}`, {
          headers,
          credentials: "include",
          signal: controller.signal
        });
      };

      try {
        let response = await open();

        /* This is a raw `fetch`, so the client's own 401 → refresh → retry does
           not apply. An access token expiring is routine on a board left open
           all shift: refresh once, through the same single-flight refresh every
           other request uses, and reconnect once. A second 401 is a dead
           session, and the stream stays off. */
        if (response.status === 401 && !cancelled && (await refreshSession(locale)) && !cancelled) {
          response = await open();
        }

        /* A 403 here is the second factor, and a 401 that survived a refresh a
           dead session — both are answered by something other than a stream, so
           this is not a transient failure to retry into. */
        if (!response.ok || response.body === null) {
          if (!cancelled) setState("off");
          return;
        }

        if (!cancelled) setState("live");

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) return;
          buffer += value;

          /* SSE frames are separated by a blank line. `event:`/`data:` pairs are
             ignored except for the `data:` payload, because there is exactly one
             event name here (`board`) and matching on it would mean dropping the
             payload if the server ever added a comment or keep-alive frame. */
          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const dataLine = frame
              .split("\n")
              .find((line) => line.startsWith("data:"));
            if (dataLine !== undefined) {
              try {
                const parsed: unknown = JSON.parse(dataLine.slice(5).trim());
                /* Shaped-checked rather than cast: a malformed payload must not
                   be written into the state the whole board renders from. */
                if (typeof parsed === "object" && parsed !== null && "generatedAt" in parsed && "alerts" in parsed) {
                  setBoard(parsed as OpsBoard);
                }
              } catch {
                /* A truncated frame is the stream's problem to redeliver; it never
                   becomes the board. */
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }

        if (!cancelled) setState("off");
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError") && !cancelled) setState("off");
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
      controllerRef.current = null;
    };
  }, [locale, enabled, attempt]);

  return { board, state: enabled ? state : "off", reconnect };
}

/* ---- tiles ------------------------------------------------------------ */

type Tile = { label: string; value: string; tone?: "rose" | "amber" };

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-5">
          <p className="text-sm text-muted">{tile.label}</p>
          <p
            className={`mt-2 text-3xl font-semibold tabular-nums tracking-[-0.04em] ${
              tile.tone === "rose" ? "text-rose-700" : tile.tone === "amber" ? "text-amber-700" : "text-navy"
            }`}
          >
            {tile.value}
          </p>
        </Card>
      ))}
    </div>
  );
}

/* ---- the screen ------------------------------------------------------- */

/**
 * The board.
 *
 * Exported as `AdminOps` because that is the name
 * `app/[locale]/(portal)/admin/ops/page.tsx` imports. The previous
 * `AdminOps` in `ops-view.tsx` is replaced by this; that file keeps the
 * `/admin` landing (`AdminOverview`), which is a different screen.
 */
export function AdminOpsBoard({ locale, dict, eyebrow }: { locale: Locale; dict: Dictionary; /** The area it is shown in; FINANCE reaches it under `/finance`. */ eyebrow?: string }) {
  const snapshot = useOpsBoard(locale);
  const [liveEnabled, setLiveEnabled] = useState(LIVE_STREAM_AVAILABLE);
  const stream = useOpsBoardStream(locale, LIVE_STREAM_AVAILABLE && liveEnabled);

  /* The stream wins when it has something: it is the newer snapshot. Falling
     back to the REST read means the board is still correct the moment the page
     loads, before any socket has opened. */
  const board = stream.board ?? snapshot.data ?? null;

  const fetchedAt = stream.board?.generatedAt ?? snapshot.data?.generatedAt ?? null;

  const escrow = board === null ? null : escrowPaisa(board);

  const tiles: Tile[] =
    board === null
      ? []
      : [
          { label: dict.ops.bookingsCreatedToday, value: formatNumber(board.bookingsToday.total, locale) },
          {
            label: dict.ops.slaBreachedVerifications,
            value: formatNumber(board.slaBreaches.verifications, locale),
            tone: board.slaBreaches.verifications > 0 ? "rose" : undefined
          },
          {
            label: dict.ops.slaBreachedComplaints,
            value: formatNumber(board.slaBreaches.complaints, locale),
            tone: board.slaBreaches.complaints > 0 ? "rose" : undefined
          },
          {
            label: dict.ops.openDisputes,
            value: formatNumber(board.openDisputes.total, locale),
            tone: board.openDisputes.awaitingReply > 0 ? "amber" : undefined
          },
          {
            label: dict.ops.debtBlockedProviders,
            value: formatNumber(board.debtBlockedProviders, locale),
            tone: board.debtBlockedProviders > 0 ? "amber" : undefined
          },
          {
            label: dict.ops.queueOutbox,
            value: formatNumber(board.queueDepth.outbox, locale),
            tone: board.queueDepth.outbox > 100 ? "amber" : undefined
          },
          { label: dict.ops.queueNotifications, value: formatNumber(board.queueDepth.notifications, locale) },
          { label: dict.ops.queuePayments, value: formatNumber(board.queueDepth.payments, locale) },
          { label: dict.ops.queueVerification, value: formatNumber(board.queueDepth.verification, locale) },
          { label: dict.ops.queueProjections, value: formatNumber(board.queueDepth.projections, locale) },
          {
            label: dict.ops.escrowHeld,
            value: escrow === null ? dict.ops.unreadable : formatMoney(escrow, locale)
          },
          { label: dict.ops.bookingsHoldingEscrow, value: formatNumber(board.escrow.bookingsHolding, locale) }
        ];

  /* `byStatus` is an object keyed by whatever statuses the table happens to hold,
     so it is rendered as a sorted list rather than a fixed set of columns — a
     fixed set would show zeroes for statuses that do not exist yet and imply the
     platform knows about them. */
  const statuses = board === null ? [] : Object.entries(board.bookingsToday.byStatus).sort((a, b) => b[1] - a[1]);

  const connectionBadge = !LIVE_STREAM_AVAILABLE ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
      <RefreshCcw className="size-3" aria-hidden="true" />
      {dict.ops.pollingBadge}
    </span>
  ) : stream.state === "live" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
        <CircleDot className="size-3" aria-hidden="true" />
        {dict.ops.live}
      </span>
    ) : stream.state === "connecting" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-primary-strong">
        <Activity className="size-3 animate-pulse" aria-hidden="true" />
        {dict.ops.connecting}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
        <Pause className="size-3" aria-hidden="true" />
        {dict.ops.notLive}
      </span>
    );

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow ?? dict.portal.admin}
        title={dict.admin.ops}
        description={dict.ops.description}
        action={
          <div className="flex items-center gap-2">
            {connectionBadge}
            {!LIVE_STREAM_AVAILABLE ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void snapshot.refetch()} disabled={snapshot.isFetching}>
                <RefreshCcw className="size-3.5" aria-hidden="true" />
                {dict.ops.refreshNow}
              </Button>
            ) : null}
            {LIVE_STREAM_AVAILABLE ? (
            <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={liveEnabled}
              onClick={() => setLiveEnabled(false)}
            >
              <Pause className="size-3.5" aria-hidden="true" />
              {dict.ops.pauseLive}
            </Button>
            {liveEnabled ? (
              <Button type="button" variant="secondary" size="sm" onClick={stream.reconnect}>
                <RefreshCcw className="size-3.5" aria-hidden="true" />
                {dict.ops.reconnect}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setLiveEnabled(true)}>
                <Play className="size-3.5" aria-hidden="true" />
                {dict.ops.resumeLive}
              </Button>
            )}
            </>
            ) : null}
          </div>
        }
      />

      {snapshot.isLoading && board === null ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted" aria-busy="true">
          {dict.portal.financeLoading}
        </Card>
      ) : snapshot.isError && board === null ? (
        /* A 403 here is the second factor, not an empty platform — see the note at
           the top of `features/admin/api.ts`. */
        <div role="alert" className="mt-6 rounded-[14px] border border-rose-200 bg-rose-50 p-5">
          <p className="text-sm font-medium leading-6 text-rose-800">
            {snapshot.error instanceof Error ? snapshot.error.message : dict.admin.adminTotpRequired}
          </p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => void snapshot.refetch()}>
            {dict.catalogue.retry}
          </Button>
        </div>
      ) : board === null ? (
        <Card className="mt-6 p-8 text-center text-sm text-muted">{dict.ops.nothingToShow}</Card>
      ) : (
        <>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Gauge className="size-3.5" aria-hidden="true" />
            <span>
              {fetchedAt === null
                ? dict.ops.neverComputed
                : dict.ops.computedAt.replace("{time}", formatDateTime(fetchedAt, locale))}
            </span>
            {stream.state === "off" ? <span className="text-amber-700">{dict.ops.staleWarning}</span> : null}
          </p>

          <div className="mt-4">
            <TileGrid tiles={tiles} />
          </div>

          <Card className="mt-6 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <TriangleAlert className="size-4 text-muted" aria-hidden="true" />
              {dict.ops.alerts}
            </h2>
            {board.alerts.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-secondary">{dict.ops.noAlerts}</p>
            ) : (
              /* **Order is the server's.** `ops-board.service.ts:114` pushes CRITICAL
                 first deliberately, so the top of this list is where to start.
                 Sorting here would undo that. */
              <ul className="mt-3 space-y-2">
                {board.alerts.map((alert) => (
                  <li
                    key={alert.code}
                    className={`rounded-[9px] border p-4 ${
                      alert.severity === "CRITICAL"
                        ? "border-rose-200 bg-rose-50"
                        : alert.severity === "WARNING"
                          ? "border-amber-200 bg-amber-50"
                          : "border-line bg-slate-50"
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        alert.severity === "CRITICAL" ? "text-rose-900" : alert.severity === "WARNING" ? "text-amber-900" : "text-navy"
                      }`}
                    >
                      {alert.detail}
                    </p>
                    <p className="mt-0.5 text-xs text-secondary">
                      {alert.code} · {dict.ops.alertsCount.replace("{count}", formatNumber(alert.count, locale))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-6 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy">
              <Activity className="size-4 text-muted" aria-hidden="true" />
              {dict.ops.bookingsByStatus}
            </h2>
            {statuses.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-secondary">{dict.ops.noBookingsToday}</p>
            ) : (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {statuses.map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between rounded-[9px] border border-line px-3 py-2">
                    <dt className="text-sm text-secondary">{status}</dt>
                    <dd className="text-sm font-semibold text-navy tabular-nums">{formatNumber(count, locale)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </>
      )}
    </div>
  );
}