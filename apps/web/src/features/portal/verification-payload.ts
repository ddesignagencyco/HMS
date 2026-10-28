/* The agent console's submit body, built outside the component so the rules it
   encodes can be tested without rendering a 1,000-line screen. */

import type { AgentSubmitPayload } from "@/features/portal/api";

/** Rupees as the agent typed them → integer paisa, or null when not a positive amount. */
export const extraChargeAmountToPaisa = (rupees: string): number | null => {
  const trimmed = rupees.trim();
  if (trimmed === "" || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const paisa = Math.round(Number(trimmed) * 100);
  return Number.isSafeInteger(paisa) && paisa > 0 ? paisa : null;
};

export type SubmitAnswers = {
  outcome: AgentSubmitPayload["outcome"];
  workCompleted: AgentSubmitPayload["workCompleted"];
  scores: Pick<AgentSubmitPayload, "quality" | "punctuality" | "conduct" | "cleanliness">;
  extraChargeDemanded: boolean;
  extraChargeAmountPaisa: number | null;
  uniformWorn: boolean;
  ownTools: boolean;
  consentLineRead: boolean;
  /** The customer's spoken answer — never derived from the outcome. */
  consentToRelease: boolean;
  /** The customer's words as the agent typed them; empty means nothing is sent. */
  remark: string;
  recordingRef: string | null;
  callSeconds: number;
};

/**
 * The submit body, exactly as `submitSchema` (`.strict()`) takes it:
 * `consentToRelease` is the customer's recorded answer, `extraChargeAmountPaisa`
 * goes only with a "yes", and `remark` is the customer's transcribed words or
 * nothing at all — the server publishes it as their review.
 */
export const buildSubmitPayload = (input: SubmitAnswers): AgentSubmitPayload => {
  const remark = input.remark.trim();
  return {
    outcome: input.outcome,
    workCompleted: input.workCompleted,
    ...input.scores,
    extraChargeDemanded: input.extraChargeDemanded,
    ...(input.extraChargeDemanded && input.extraChargeAmountPaisa !== null ? { extraChargeAmountPaisa: input.extraChargeAmountPaisa } : {}),
    uniformWorn: input.uniformWorn,
    ownTools: input.ownTools,
    consentLineRead: input.consentLineRead,
    consentToRelease: input.consentToRelease,
    ...(remark === "" ? {} : { remark }),
    ...(input.recordingRef === null ? {} : { recordingRef: input.recordingRef }),
    ...(input.callSeconds > 0 ? { callDurationSeconds: input.callSeconds } : {}),
  };
};
