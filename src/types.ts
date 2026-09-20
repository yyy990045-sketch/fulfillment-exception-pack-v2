export type Support = "supported" | "partial" | "unsupported";

export type ConflictField = "amount" | "qty" | "model" | "date" | "party" | "status" | "orderId";

export type Severity = "low" | "medium" | "high" | "critical";

export type CaseStatus =
  | "new"
  | "triaged"
  | "confirmed"
  | "rejected"
  | "proposed"
  | "approved"
  | "executed"
  | "verified"
  | "closed";

export type LegacyActionType = "review_quotation";

export type ActionType =
  | "supplement_evidence"
  | "urge_follow_up"
  | "reject_overclaim"
  | "route_quotation_to_review"
  | "approve_or_change_quotation_terms"
  | "create_task";

export type PersistedActionType = ActionType | LegacyActionType;

export type ActionStatus =
  | "draft"
  | "pending_approval"
  | "authorized"
  | "executing"
  | "succeeded"
  | "failed"
  | "verified";

export type Locator = {
  fileName: string;
  sheet?: string;
  row?: number;
  cell?: string;
  line?: number;
  page?: number;
};

export type EvidenceItem = {
  id: string;
  field: ConflictField | string;
  compareKey: string;
  value: string | number | null;
  claim: string;
  sourceId: string;
  sourceKind?: GoldMaterial["kind"];
  sourceVersion: string;
  locator: Locator;
  quote: string;
  confidence: number;
  support: Support;
  tenantId: string;
  scope: string;
};

export type ConflictPair = {
  id: string;
  issueId?: string;
  field: ConflictField;
  leftEvidenceId: string;
  rightEvidenceId: string;
  leftValue: string | number | null;
  rightValue: string | number | null;
  severity: Severity;
  resolution: "unresolved" | "resolved" | "needs_evidence";
};

export type ConflictIssue = {
  id: string;
  field: ConflictField;
  severity: Severity;
  conflictIds: string[];
  evidenceIds: string[];
  values: Array<string | number | null>;
  resolution: "unresolved" | "resolved" | "needs_evidence";
};

export type ConflictReview = {
  conflictId: string;
  issueId?: string;
  decision: "acknowledge" | "accept_left" | "accept_right" | "needs_evidence";
  selectedEvidenceId?: string;
  selectedValue?: string | number | null;
  rationale: string;
  actor: string;
  at: string;
};

export type ReportDecision = {
  decision: "accept" | "supplement" | "reject";
  rationale: string;
  actor: string;
  at: string;
};

export type EvidencePack = {
  schemaVersion: "evidence-pack-v1";
  tenantId: string;
  caseId: string;
  evidence: EvidenceItem[];
  structuredFields: Record<string, unknown>;
  conflicts: ConflictPair[];
  conflictIssues?: ConflictIssue[];
  gaps: string[];
  traceId: string;
  sourceAttempts?: EvidenceSourceAttempt[];
  selectedSourceId?: string;
};

export type EvidenceSourceAttempt = {
  endpointId: string;
  status?: number;
  outcome: "selected" | "fallback" | "failed";
  errorCode?: "timeout" | "network" | "http" | "invalid_csv" | "invalid_payload" | "empty";
  durationMs: number;
  contentHash?: string;
};

export type CapabilityRecord = {
  action: "versions" | "review" | "outcome" | "audit";
  status: "recorded" | "pending";
  result?: string;
  rationale?: string;
  actor: string;
  at: string;
  receipt?: string;
  externalRequestId?: string;
  receiptSource?: "local-ledger";
};

export type CapabilityReceipt = {
  tenantId: string;
  caseId: string;
  actionId: string;
  operationKey: string;
  externalRequestId: string;
  receipt: string;
  receiptSource: "local-ledger";
  status: "succeeded" | "failed";
  payloadHash: string;
  createdAt: string;
};

export type Finding = {
  id: string;
  field: ConflictField;
  statement: string;
  evidenceIds: string[];
  conflictId?: string;
  severity: Severity;
  status: "candidate" | "accepted";
};

export type ActionRecord = {
  id: string;
  type: PersistedActionType;
  summary: string;
  status: ActionStatus;
  idempotencyKey: string;
  requiresApproval: true;
  approvedBy?: string;
  receipt?: string;
  externalRequestId?: string;
  receiptSource?: "local-ledger";
  receiptAt?: string;
  failReason?: string;
};

export type CaseRecord = {
  id: string;
  title: string;
  tenantId: string;
  scope: string;
  status: CaseStatus;
  ownerRole: string;
  pack?: EvidencePack;
  findings: Finding[];
  actions: ActionRecord[];
  reviewedConflictIds?: string[];
  reviewedIssueIds?: string[];
  conflictReviews?: ConflictReview[];
  reportDecision?: ReportDecision;
  capabilityRecords?: CapabilityRecord[];
  executionIdempotencyKey?: string;
  events: Array<{ at: string; from?: string; to: string; actor: string; reason: string }>;
  paused?: boolean;
  pausedAfter?: "Intake" | "Evidence" | "Review" | "Resolution" | "Verification";
  graphLog?: Array<"Intake" | "Evidence" | "Review" | "Resolution" | "Verification">;
};

export type GoldMaterial = {
  sourceId: string;
  fileName: string;
  kind: "quote" | "order" | "payment" | "complaint" | "email" | "alert";
  version: string;
  tenantId: string;
  scope: string;
  csv?: string;
  markdown?: string;
};

export type GoldCase = {
  id: string;
  title: string;
  tenantId: string;
  scope: string;
  ownerRole: string;
  pack: "fulfillment" | "it-alert";
  materials: GoldMaterial[];
  expectedFacts: Array<{ field: string; value: string | number; sourceId: string }>;
  expectedConflicts: Array<{ field: ConflictField; left: string | number; right: string | number }>;
  expectedGaps: string[];
  expectedActionTypes: ActionType[];
  negatives: Array<"no_scope" | "cross_tenant" | "no_locator" | "skip_approval" | "duplicate_action" | "no_evidence_conclusion">;
  closeWhen: string;
};
