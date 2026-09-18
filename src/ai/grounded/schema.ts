export const GROUNDED_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executiveSummary", "facts", "discrepancy", "uncertainties", "questionsToVerify", "prohibitedConclusions"],
  properties: {
    executiveSummary: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "key", "value", "statement", "evidenceIds"],
        properties: {
          kind: { type: "string", enum: ["expected", "actual", "metric", "source_fact"] },
          key: { type: "string" },
          value: { anyOf: [{ type: "string" }, { type: "number" }] },
          statement: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    discrepancy: {
      type: "object",
      additionalProperties: false,
      required: ["statement", "evidenceIds"],
      properties: {
        statement: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
      },
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "evidenceIds"],
        properties: {
          statement: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    questionsToVerify: { type: "array", items: { type: "string" } },
    prohibitedConclusions: { type: "array", items: { type: "string" } },
  },
} as const;

export function groundedExplanationJsonSchema() {
  return GROUNDED_EXPLANATION_JSON_SCHEMA;
}
