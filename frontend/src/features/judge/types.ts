/**
 * 评委视图（只读聚合）类型。
 *
 * 后端返回的是 `JudgeEvidenceManifest`（同 demo:judge 写出的 evidence.json）。
 * 这里只声明页面真正消费的字段 —— 不做全量镜像，避免前端成为第二份契约。
 */
export type JudgeSourceRefView = {
  role: "order" | "production";
  systemKey: string;
  systemType: string | null;
  evidenceId: string;
  sourceDocumentId: string;
  field: string;
  value: unknown;
  valueType: string;
  observedAt: string;
  unsTopic: string | null;
  rawHash: string | null;
};

export type JudgeManifestView = {
  schemaVersion: string;
  generatedAt: string;
  scenario: string;
  scenarioLabel: string;
  businessQuestion: string;
  industrialContext: {
    enterpriseId: string;
    siteId: string;
    areaId: string;
    lineId: string;
    equipmentIds: string[];
    unsRootPath: string | null;
  } | null;
  businessFacts: {
    orderedQuantity: number;
    productionCompletedQuantity: number;
    difference: number;
    unit: string;
  };
  sources: {
    order: JudgeSourceRefView | null;
    production: JudgeSourceRefView | null;
  };
  uns: {
    orderTopic: string | null;
    productionTopic: string | null;
    topicConvention: string;
  };
  evidence: {
    orderEvidenceId: string | null;
    productionEvidenceId: string | null;
    totalCount: number;
  };
  rule: {
    code: string;
    result: string;
    expected: number | null;
    actual: number | null;
    difference: number | null;
  };
  exception: {
    id: string;
    code: string;
    severity: string;
    title: string;
    summary: string;
  } | null;
  governance: {
    status: string;
    stage: string;
    caseId: string | null;
    ownerRole: string | null;
    proposedBy: string | null;
    approvedBy: string | null;
    segregationOfDutiesEnforced: boolean;
  };
  execution: {
    status: string;
    downstream: string | null;
    receiptId: string | null;
    mismatches: string[];
    apiWriteIsNotBusinessCompletion: true;
  };
  outcome: {
    status: string;
    definitionId: string | null;
    baseline: number | string | null;
    current: number | string | null;
    target: number | string | null;
    causalAttribution: false;
  };
  ai: {
    provider: string;
    model: string;
    recommendationId: string | null;
    recommendationStatus: string | null;
    humanDecisionRequired: boolean;
    canApprove: false;
    canExecute: false;
    note: string;
  };
  trace: {
    status: string;
    failures: string[];
    hops: string[];
    evidenceLinks: number;
    payloadSourcePath: string | null;
  };
  truthBoundary: Record<string, boolean>;
  artifacts: {
    unsStream: string | null;
    evidenceManifest: string | null;
    readback: string | null;
  };
};
