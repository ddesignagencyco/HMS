import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceDebts } from "@/features/portal/finance-views";
import { getDictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/utils";

const dict = getDictionary("en");
const locale: Locale = "en";

const wrap = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("FinanceDebts view", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/finance/debts")) {
          return new Response(
            JSON.stringify({
              totalDebtPaisa: 750000,
              items: [
                {
                  providerId: "prv-101",
                  providerName: "Ali Hassan",
                  debtPaisa: 600000,
                  ceilingPaisa: 500000,
                  offersBlocked: true,
                  since: "Active", // Regression check: string that used to crash formatDate
                },
                {
                  providerId: "prv-102",
                  providerName: "Zahid Khan",
                  debtPaisa: 150000,
                  ceilingPaisa: 500000,
                  offersBlocked: false,
                  createdAt: "2026-10-01T10:00:00Z",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      })
    );
  });

  it("renders debts list without throwing Invalid time value RangeError", async () => {
    render(<FinanceDebts locale={locale} dict={dict} />, { wrapper: wrap });

    // Verify provider names appear
    expect(await screen.findByText("Ali Hassan")).toBeDefined();
    expect(screen.getByText("Zahid Khan")).toBeDefined();

    // Verify non-date fallback value and status badges are rendered without crash
    expect(screen.getAllByText("Active")).toHaveLength(2);
    expect(screen.getByText("1 Oct 2026")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
  });
});
