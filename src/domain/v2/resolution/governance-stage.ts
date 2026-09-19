import type { ActionStatus, CaseStatus } from "../../../types.js";

export type GovernanceStage =
  | "not_started"
  | "review"
  | "proposal"
  | "proposal_draft"
  | "pending_approval"
  | "approved"
  | "executed"
  | "closed"
  | "rejected";

export function resolutionGovernanceStage(
  status: CaseStatus | undefined,
  actions: Array<{ status: ActionStatus }> = [],
): GovernanceStage {
  if (!status || status === "new") return "not_started";
  if (status === "triaged") return "review";
  if (status === "confirmed") return "proposal";
  if (status === "proposed") {
    return actions.length > 0 && actions.every((action) => action.status === "pending_approval")
      ? "pending_approval"
      : "proposal_draft";
  }
  if (status === "approved") return "approved";
  if (status === "executed" || status === "verified") return "executed";
  if (status === "closed") return "closed";
  return "rejected";
}
