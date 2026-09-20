import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const openapi = readFileSync(new URL("../contracts/openapi.yaml", import.meta.url), "utf8");

function pathBlock(path: string, nextPath: string) {
  const start = openapi.indexOf(`  ${path}:`);
  const end = openapi.indexOf(`  ${nextPath}:`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return openapi.slice(start, end);
}

describe("OpenAPI 502 ownership", () => {
  it("keeps refresh 502 bound to Evidence BadGateway", () => {
    const block = pathBlock("/api/cases/{id}/refresh", "/api/cases/{id}/review");
    expect(block).toContain("'502': { $ref: '#/components/responses/BadGateway' }");
    expect(block).not.toContain("'502': { $ref: '#/components/responses/AIProviderFailure' }");
  });

  it("binds grounded explanation POST 502 to AIProviderFailure", () => {
    const block = pathBlock(
      "/api/v2/contexts/{contextId}/exceptions/{exceptionId}/explanations",
      "/api/v2/contexts/{contextId}/exceptions/{exceptionId}/explanations/{explanationId}",
    );
    expect(block).toContain("'502': { $ref: '#/components/responses/AIProviderFailure' }");
    expect(block).not.toContain("'502': { $ref: '#/components/responses/BadGateway' }");
  });

  it("defines a strict decision recommendation summary contract", () => {
    const summaryStart = openapi.indexOf("    DecisionRecommendationSummary:");
    const summaryEnd = openapi.indexOf("    DecisionRecommendationDisposition:", summaryStart);
    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    const summary = openapi.slice(summaryStart, summaryEnd);
    expect(summary).toContain("additionalProperties: false");
    expect(summary).toContain("stale");
    expect(summary).not.toContain("output: { type: object");
    expect(openapi).toContain("items: { $ref: '#/components/schemas/DecisionRecommendationSummary' }");
  });

  it("defines strict root cause hypothesis and review contracts", () => {
    expect(openapi).toContain("    RootCauseAnalysisSummary:");
    expect(openapi).toContain("    RootCauseAnalysis:");
    expect(openapi).toContain("    RootCauseHypothesisReview:");
    expect(openapi).toContain("epistemicStatus: { type: string, enum: [hypothesis] }");
    expect(openapi).toContain("analyses: { type: array, items: { $ref: '#/components/schemas/RootCauseAnalysisSummary' } }");
  });

  it("defines strict deterministic policy evaluation contracts", () => {
    expect(openapi).toContain("    PolicyEvaluation:");
    expect(openapi).toContain("    PolicyEvaluationDecision:");
    expect(openapi).toContain("automationAvailable: { type: boolean, enum: [false] }");
    expect(openapi).toContain("executionPerformed: { type: boolean, enum: [false] }");
    expect(openapi).toContain("evaluations: { type: array, items: { $ref: '#/components/schemas/PolicyEvaluation' } }");
  });

  it("defines strict policy-bounded automation contracts", () => {
    expect(openapi).toContain("    AutomationReadiness:");
    expect(openapi).toContain("    AutomationRun:");
    expect(openapi).toContain("    AutomationReceipt:");
    expect(openapi).toContain("    InternalWorkItem:");
    expect(openapi).toContain("executionPerformed: { type: boolean, enum: [false] }");
    expect(openapi).toContain("receiptSource: { type: string, enum: [internal-work-item] }");
  });

  it("defines strict Evidence-backed Outcome Intelligence contracts", () => {
    expect(openapi).toContain("    OutcomeDefinition:");
    expect(openapi).toContain("    OutcomeEvaluation:");
    expect(openapi).toContain("    OutcomeEvaluationList:");
    expect(openapi).toContain("    OutcomeAnalyticsSummary:");
    expect(openapi).toContain("causalAttribution: { type: boolean, enum: [false] }");
    expect(openapi).toContain("outcomes: { $ref: '#/components/schemas/OutcomeAnalyticsSummary' }");
  });

  it("defines strict backend-owned Resolution capability contracts", () => {
    expect(openapi).toContain("    CurrentActorContext:");
    expect(openapi).toContain("    CapabilityDecision:");
    expect(openapi).toContain("    ResolutionCapabilities:");
    expect(openapi).toContain("    ResolutionCapabilitiesResponse:");
    expect(openapi).toContain("additionalProperties: false");
    expect(openapi).toContain("organizationSource: { type: string, enum: [demo, claim, tenant_fallback] }");
    expect(openapi).toContain("canApprove: { $ref: '#/components/schemas/CapabilityDecision' }");
    expect(openapi).toContain("assignableOwnerRoles: { type: array, items: { type: string } }");
  });

  it("defines commercial-pilot projections for governance stage, Pack binding, actions, trends, and demo workspaces", () => {
    expect(openapi).toContain("    GovernanceStage:");
    expect(openapi).toContain("governanceStage: { $ref: '#/components/schemas/GovernanceStage' }");
    expect(openapi).toContain("    PackBoundContext:");
    expect(openapi).toContain("boundContexts: { type: array, items: { $ref: '#/components/schemas/PackBoundContext' } }");
    expect(openapi).toContain("    PackSupportedAction:");
    expect(openapi).toContain("supportedActions: { type: array, items: { $ref: '#/components/schemas/PackSupportedAction' } }");
    expect(openapi).toContain("label: { type: string }");
    expect(openapi).toContain("from: { type: string, format: date-time }");
    expect(openapi).toContain("timeBasis: { type: string, enum: [context_opened, exception_occurrence] }");
    expect(openapi).toContain("trendTimeBasis: { type: string, enum: [exception_occurrence] }");
    expect(openapi).toContain("    DemoWorkspaceProjection:");
    expect(openapi).toContain("demoWorkspace: { $ref: '#/components/schemas/DemoWorkspaceProjection' }");
  });

  it("defines the Power BI embed boundary without exposing Entra credentials", () => {
    const block = pathBlock(
      "/api/v2/analytics/powerbi/embed-config",
      "/api/v2/solution-packs",
    );
    expect(block).toContain("PowerBiEmbedConfig");
    expect(block).toContain("'503'");
    expect(block).toContain("'403'");
    expect(block).toContain("scope_forbidden");
    expect(block).toContain("POWERBI_TENANT_FORBIDDEN");
    expect(openapi).toContain("    PowerBiEmbedConfig:");
    expect(openapi).toContain("embedToken: { type: string }");
    expect(openapi).not.toContain("entraAccessToken");
    expect(openapi).not.toContain("clientSecret");
    expect(openapi).not.toContain("clientId");
    expect(openapi).not.toContain("entraTenantId");
    expect(openapi).not.toContain("productTenantId");
  });
});
