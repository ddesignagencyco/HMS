"use client";

/* The onboarding submit card — `POST /provider/submit`.
 *
 * **This call existed and nothing in the product made it.** Registering a provider
 * account puts the row straight into `PENDING_APPROVAL` (FR-SP-01), which reads as
 * "queued" on the admin approval screen — but it is only a statement about the
 * *account*. `submitted_at` is what says onboarding is finished and there is
 * something to review, and nothing set it: an admin looking at the approval queue
 * could not tell a half-filled profile from a complete one, which is the exact gap
 * SHM-021 was raised to close.
 *
 * So the button is here, on the professional's dashboard, and it is only offered
 * where it can succeed:
 *
 * · **`submittedAt` already set means it is done.** `submit` answers 409 in that
 *   case, and offering a button whose only outcome is a conflict would be a lie
 *   about what the button does.
 *
 * · **Unfinished steps come back as 400 with `errors[].path`**, one entry per
 *   missing step, each naming the screen that closes it
 *   (`provider-onboarding.service.ts:26`). Those are rendered as **links**, because
 *   the server has told us exactly where to go — which is the one thing a
 *   completeness checklist the client computes for itself always gets wrong.
 *
 * The penalty schedule is accepted as part of the submit (`acceptPenaltySchedule:
 * true` is sent by the API client and cannot be omitted), and the card says so
 * before the press rather than letting a professional accept it unknowingly.
 */

import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, Card } from "@/components/ui";
import {
  isOnboardingStepPath,
  providerApi,
  type OnboardingStepPath
} from "@/features/provider/api";
import { providerKeys } from "@/lib/api/keys";
import type { Dictionary } from "@/lib/dictionaries";
import { localizedPath, type Locale } from "@/lib/utils";

/** Where each step lives, so a server-named path becomes a link rather than text. */
const STEP_ROUTES: Record<OnboardingStepPath, string> = {
  profile: "/provider/profile",
  services: "/provider/services",
  areas: "/provider/areas",
  availability: "/provider/calendar",
  documents: "/provider/documents"
};

export function ProviderSubmitCard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const queryClient = useQueryClient();
  const [missing, setMissing] = useState<{ path: string; message: string }[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  /* Whether *this browser* has submitted.
   *
   * **`GET /provider/profile` does not return `submitted_at`** — it selects status,
   * bio, experience, qualification, city, base address and radius, and nothing
   * else. So there is no read to answer "have they already submitted?" on a fresh
   * page load, and the honest answer here is that this component does not know.
   *
   * It is set from the POST's own response, which *does* carry `submittedAt`, and
   * the 409 from a later press is what covers the case of somebody who submitted
   * on another device. Guessing "not submitted" from a missing field and showing
   * the button would have been a worse answer than saying nothing was read. */
  const [submittedHere, setSubmittedHere] = useState(false);

  const submit = useMutation({
    mutationFn: () => providerApi.submitForApproval({ locale }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.all });
      setSubmittedHere(result.submittedAt !== null);
      toast.success(dict.provider.submitDone);
      setMissing([]);
      setConflict(null);
    },
    onError: (cause: Error & { status?: number; problem?: { errors?: { path: string; message: string }[] } }) => {
      setMissing([]);
      setConflict(null);
      /* 409 is a state answer, not a failure: already submitted, or a status
         that cannot enter the queue. Either way there is nothing to fix here. */
      if (cause.status === 409) {
        setConflict(cause.message || dict.provider.submitConflict);
        return;
      }
      /* 400 carries one entry per missing step, and those are links. */
      const errors = cause.problem?.errors ?? [];
      if (cause.status === 400 && errors.length > 0) {
        setMissing(errors.map((entry) => ({ path: entry.path, message: entry.message })));
        toast.error(dict.provider.submitIncomplete);
        return;
      }
      toast.error(cause.message || dict.provider.submitFailed);
    },
    retry: false
  });

  /* Submitted from this browser: the button goes, because the only possible
     answer from here is a 409. A rejection clears `submitted_at` server-side and
     the card comes back — but that shows on the next visit, since nothing here can
     read it. */
  if (submittedHere) {
    return (
      <Card className="mt-6 border-emerald-200 bg-emerald-50 p-5">
        <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {dict.provider.submittedTitle}
        </p>
        <p className="mt-1 text-sm leading-6 text-emerald-800">{dict.provider.submittedText}</p>
      </Card>
    );
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="font-semibold text-navy">{dict.provider.submitTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-secondary">{dict.provider.submitText}</p>

      {conflict !== null ? (
        <p role="status" className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {conflict}
        </p>
      ) : null}

      {missing.length > 0 ? (
        <div role="alert" className="mt-4 rounded-[9px] border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold leading-6 text-amber-900">{dict.provider.submitIncompleteTitle}</p>
          <ul className="mt-2 space-y-2">
            {missing.map((entry) => (
              <li key={entry.path} className="text-sm leading-6 text-amber-800">
                {/* The server's `message` is the instruction ("Set your city and
                    base location") and it is what is shown. The link is an
                    addition on top of it, present only when this build knows the
                    path — a step the backend adds later still renders as its
                    sentence rather than dropping off the list. */}
                {entry.message}
                {isOnboardingStepPath(entry.path) ? (
                  <>
                    {" — "}
                    <a href={localizedPath(locale, STEP_ROUTES[entry.path])} className="font-semibold underline">
                      {dict.provider.submitGoTo.replace("{step}", dict.provider.submitSteps[entry.path])}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The penalty schedule is a real acceptance and the API records it as one,
           so it is a distinct, explicit tick rather than being folded into the
           submit. */}
      <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-secondary">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1 size-4 shrink-0 rounded border-line text-primary focus:ring-4 focus:ring-blue-100"
        />
        <span>{dict.provider.submitAcceptSchedule}</span>
      </label>

      <Button type="button" className="mt-4" disabled={!accepted || submit.isPending} onClick={() => submit.mutate()}>
        {submit.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="size-4" aria-hidden="true" />
        )}
        {submit.isPending ? dict.provider.submitting : dict.provider.submitAction}
      </Button>
    </Card>
  );
}