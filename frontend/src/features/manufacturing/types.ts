import type { components } from "../../api/schema.js";

type GeneratedWorkbench = components["schemas"]["V2ManufacturingWorkbenchResponse"];
type GeneratedEvidenceBundle = components["schemas"]["V2ExceptionEvidenceBundle"];

export type WorkbenchContext = {
  id: string;
  businessKey: string;
  contextType: string;
  status: string;
  openedAt: string;
  updatedAt: string;
};

export type WorkbenchStats = {
  sourceSystems: number;
  entities: number;
  documents: number;
  events: number;
  evidence: number;
  ruleEvaluations: number;
  matchedRules: number;
  notMatchedRules: number;
  exceptions: number;
  resolutionCases: number;
};

export type ThreadFact = {
  key: string;
  label: string;
  field: string;
  value: unknown;
  valueType: string;
  evidenceId: string;
  observedAt: string;
};

export type ThreadStage = {
  key: string;
  label: string;
  entityId: string;
  businessKey: string;
  state: "normal" | "exception";
  facts: ThreadFact[];
  occurredAt: string | null;
  sourceSystem: { id: string; name: string; systemType: string } | null;
  sourceDocument: { id: string; externalDocumentId: string; documentType: string; version: string } | null;
  latestEvent: { id: string; eventType: string; label: string; occurredAt: string } | null;
};

export type RuleView = {
  id: string;
  code: string;
  label: string;
  status: string;
  statusLabel: string;
  matched: boolean;
  stageKeys: string[];
  metrics: Record<string, unknown>;
  ruleId: string;
  ruleVersion: string;
  evaluatedAt: string;
};

export type ExceptionView = {
  id: string;
  code: string;
  label: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  matchKey: string;
  ruleId: string;
  ruleVersionId: string;
  latestRuleEvaluationId: string;
  entityIds: string[];
  stageKeys: string[];
  evidenceCount: number;
  sourceSystemCount: number;
  createdAt: string;
  lastDetectedAt: string;
};

export type WorkbenchView = Omit<GeneratedWorkbench, "context" | "stats" | "thread" | "rules" | "exceptions"> & {
  context: WorkbenchContext;
  stats: WorkbenchStats;
  thread: ThreadStage[];
  rules: RuleView[];
  exceptions: ExceptionView[];
};

export type EvidenceRole = "expected" | "actual" | "claim" | "context";

export type EvidenceItem = {
  evidenceId: string;
  role: EvidenceRole;
  field: string;
  value: unknown;
  valueType: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  sourceVersion: string;
  eventId?: string;
  observedAt: string;
  support: string;
  quote: string;
  confidence?: number;
  locator?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type EvidenceSourceSystem = {
  id: string;
  name: string;
  systemType: string;
};

export type EvidenceSourceDocument = {
  id: string;
  externalDocumentId: string;
  documentType: string;
  version: string;
};

export type EvidenceBundleView = Omit<GeneratedEvidenceBundle, "evidence" | "sourceDocuments" | "sourceSystems"> & {
  evidence: EvidenceItem[];
  sourceDocuments: EvidenceSourceDocument[];
  sourceSystems: EvidenceSourceSystem[];
};
