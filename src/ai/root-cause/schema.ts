export const ROOT_CAUSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "hypotheses", "uncertainties", "humanVerificationRequired", "prohibitedConclusions"],
  properties: {
    summary: { type: "string" },
    hypotheses: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "epistemicStatus", "supportingEvidenceIds", "contradictingEvidenceIds", "missingEvidence", "verificationSteps"],
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          epistemicStatus: { type: "string", const: "hypothesis" },
          supportingEvidenceIds: { type: "array", items: { type: "string" } },
          contradictingEvidenceIds: { type: "array", items: { type: "string" } },
          missingEvidence: { type: "array", items: { type: "string" } },
          verificationSteps: { type: "array", items: { type: "string" } },
        },
      },
    },
    uncertainties: { type: "array", items: { type: "string" } },
    humanVerificationRequired: { type: "boolean", const: true },
    prohibitedConclusions: { type: "array", items: { type: "string" } },
  },
} as const;

export function rootCauseJsonSchema() {
  return ROOT_CAUSE_JSON_SCHEMA;
}
