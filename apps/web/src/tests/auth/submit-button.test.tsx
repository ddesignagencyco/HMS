import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SubmitButton } from "@/features/auth/auth-fields";

/* Before hydration an auth form has no submit handler, so a native submit sent a
   GET to the page URL with the identifier and password in the query string. The
   button is disabled in the server HTML (which also blocks Enter-key implicit
   submission) and enabled once React owns the page. */
describe("SubmitButton hydration guard", () => {
  afterEach(cleanup);

  it("is disabled in the server-rendered HTML", () => {
    const html = renderToString(
      <SubmitButton pending={false} pendingLabel="Signing in">
        Sign in
      </SubmitButton>,
    );
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("is enabled on the client when not pending, and disabled while pending", () => {
    const { rerender } = render(
      <SubmitButton pending={false} pendingLabel="Signing in">
        Sign in
      </SubmitButton>,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    rerender(
      <SubmitButton pending pendingLabel="Signing in">
        Sign in
      </SubmitButton>,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
