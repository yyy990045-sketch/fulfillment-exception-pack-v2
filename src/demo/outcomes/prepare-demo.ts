import {
  createEvidence,
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
  type V2Evidence,
} from "../../domain/v2/index.js";
import {
  evaluateOutcome,
  provisionDefaultManufacturingOutcomeDefinitions,
} from "../../outcomes/index.js";

const TENANT_ID = "demo-manufacturing";
const CONTEXT_ID = "ctx-so-mfg-001";

function syntheticEvidence(input: {
  id: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  entityId: string;
  field: string;
  value: number;
  observedAt: string;
}): V2Evidence {
  return createEvidence({
    id: input.id,
    tenantId: TENANT_ID,
    contextId: CONTEXT_ID,
    sourceSystemId: input.sourceSystemId,
    sourceDocumentId: input.sourceDocumentId,
    sourceVersion: "v1",
    entityId: input.entityId,
    field: input.field,
    value: input.value,
    valueType: "number",
    locator: { fileName: "synthetic-outcome.csv", row: 2, cell: input.field },
    quote: `${input.field}=${input.value}`,
    confidence: 1,
    support: "supported",
    observedAt: input.observedAt,
    createdAt: input.observedAt,
    metadata: { synthetic: true },
  });
}

export function provisionSyntheticOutcomePortfolio() {
  const store = openV2SqliteStore();
  provisionV2ManufacturingDemoData(store);
  evaluateContextRules(store, TENANT_ID, CONTEXT_ID);
  provisionDefaultManufacturingOutcomeDefinitions(store, TENANT_ID);
  const exceptionByCode = new Map(store.listExceptions(TENANT_ID, CONTEXT_ID).map((item) => [item.code, item]));
  const customer = exceptionByCode.get("CUSTOMER_RECEIPT_CLAIM_MISMATCH")!;
  const payment = exceptionByCode.get("PAYMENT_BALANCE_OUTSTANDING")!;
  const quality = exceptionByCode.get("QUALITY_NONCONFORMING_QUANTITY_DETECTED")!;
  const customerValues = [0, 8, 16, 20];
  const customerEvidenceIds = customerValues.map((value, index) => {
    const id = `evidence-outcome-customer-${index + 1}`;
    store.saveEvidence(syntheticEvidence({
      id,
      sourceSystemId: "SERVICE-DEMO",
      sourceDocumentId: "doc-complaint-mfg-001-v1",
      entityId: "entity-complaint-mfg-001",
      field: "verifiedReceiptDifference",
      value,
      observedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    }));
    return id;
  });
  const paymentEvidenceId = "evidence-outcome-payment-final";
  store.saveEvidence(syntheticEvidence({
    id: paymentEvidenceId,
    sourceSystemId: "FINANCE-DEMO",
    sourceDocumentId: "doc-payment-mfg-001-v1",
    entityId: "entity-payment-mfg-001",
    field: "outstandingAmount",
    value: 0,
    observedAt: "2026-10-05T00:00:00.000Z",
  }));
  const qualityEvidenceId = "evidence-outcome-quality-final";
  store.saveEvidence(syntheticEvidence({
    id: qualityEvidenceId,
    sourceSystemId: "QMS-DEMO",
    sourceDocumentId: "doc-quality-mfg-001-v1",
    entityId: "entity-quality-event-mfg-001",
    field: "openNonconformingQty",
    value: 0,
    observedAt: "2026-10-06T00:00:00.000Z",
  }));
  const definitions = store.listOutcomeDefinitions(TENANT_ID);
  const customerDefinition = definitions.find((item) => item.id === "outcome-customer-receipt-verified-difference")!;
  const paymentDefinition = definitions.find((item) => item.id === "outcome-payment-outstanding-amount")!;
  const qualityDefinition = definitions.find((item) => item.id === "outcome-quality-open-nonconforming")!;
  for (const evidenceId of customerEvidenceIds) {
    evaluateOutcome(store, TENANT_ID, CONTEXT_ID, customer.id, {
      definitionId: customerDefinition.id,
      evidenceIds: [evidenceId],
    }, "outcome-demo");
  }
  evaluateOutcome(store, TENANT_ID, CONTEXT_ID, customer.id, {
    definitionId: customerDefinition.id,
    evidenceIds: [],
  }, "outcome-demo");
  evaluateOutcome(store, TENANT_ID, CONTEXT_ID, payment.id, {
    definitionId: paymentDefinition.id,
    evidenceIds: [paymentEvidenceId],
  }, "outcome-demo");
  evaluateOutcome(store, TENANT_ID, CONTEXT_ID, quality.id, {
    definitionId: qualityDefinition.id,
    evidenceIds: [qualityEvidenceId],
  }, "outcome-demo");
  return {
    tenantId: TENANT_ID,
    contextId: CONTEXT_ID,
    statusCounts: Object.fromEntries(
      ["target_met", "improved", "unchanged", "worsened", "insufficient_evidence"].map((status) => [
        status,
        store.listOutcomeEvaluations(TENANT_ID, CONTEXT_ID, customer.id).map((item) => item.status).filter((item) => item === status).length,
      ]),
    ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(provisionSyntheticOutcomePortfolio(), null, 2));
}
