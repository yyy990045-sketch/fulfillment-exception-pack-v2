export const DECISION_RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executiveSummary", "recommendedOptionId", "options", "uncertainties", "humanDecisionRequired", "prohibitedConclusions"],
  properties: {
    executiveSummary: { type: "string" },
    recommendedOptionId: { type: "string" },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "actionType", "title", "actionSummary", "rationale", "evidenceIds", "supportingFacts", "historyClaims", "assumptions", "missingEvidence"],
        properties: {
          id: { type: "string" },
          actionType: { type: "string", enum: ["supplement_evidence", "urge_follow_up", "reject_overclaim", "route_quotation_to_review", "approve_or_change_quotation_terms", "create_task"] },
          title: { type: "string" },
          actionSummary: { type: "string" },
          rationale: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          supportingFacts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "key", "value", "evidenceIds"],
              properties: {
                kind: { type: "string", enum: ["expected", "actual", "metric", "source_fact"] },
                key: { type: "string" },
                value: { anyOf: [{ type: "string" }, { type: "number" }] },
                evidenceIds: { type: "array", items: { type: "string" } },
              },
            },
          },
          historyClaims: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "value", "statement"],
              properties: {
                key: { type: "string" },
                value: { anyOf: [{ type: "string" }, { type: "number" }] },
                statement: { type: "string" },
              },
            },
          },
          assumptions: { type: "array", items: { type: "string" } },
          missingEvidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    uncertainties: { type: "array", items: { type: "string" } },
    humanDecisionRequired: { type: "boolean", const: true },
    prohibitedConclusions: { type: "array", items: { type: "string" } },
  },
} as const;

export function decisionRecommendationJsonSchema() {
  return DECISION_RECOMMENDATION_JSON_SCHEMA;
}
