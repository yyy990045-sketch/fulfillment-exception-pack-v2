import type {
  GroundedAiProvider,
  GroundedAiRequest,
  GroundedExplanationInput,
  GroundedExplanationOutput,
  GroundedFact,
} from "./types.js";

function observation(input: GroundedExplanationInput, key: string) {
  const value = input.evaluation.observations[key];
  if (!value || value.status !== "resolved" || typeof value.value !== "number") return undefined;
  return { ...value, value: value.value };
}

function metric(input: GroundedExplanationInput, key: string) {
  const value = input.evaluation.metrics[key];
  return typeof value === "number" ? value : undefined;
}

function fact(kind: GroundedFact["kind"], key: string, value: number, statement: string, evidenceIds: string[]): GroundedFact {
  return { kind, key, value, statement, evidenceIds };
}

function customerClaimOutput(input: GroundedExplanationInput): GroundedExplanationOutput {
  const shipment = observation(input, "shipmentQty")!;
  const claim = observation(input, "claimedReceivedQty")!;
  const difference = metric(input, "difference")!;
  return {
    executiveSummary: `系统发货记录为${shipment.value}件，客户在客诉记录中主张收到${claim.value}件。两项记录存在${difference}件差异，当前证据只能确认记录不一致，尚不能确认实际签收数量。`,
    facts: [
      fact("source_fact", "qty", shipment.value, `系统发货记录为${shipment.value}件。`, shipment.evidenceIds),
      fact("source_fact", "claimedReceivedQty", claim.value, `客户在客诉记录中主张收到${claim.value}件。`, claim.evidenceIds),
      fact("metric", "difference", difference, `两项记录差异为${difference}件。`, [...shipment.evidenceIds, ...claim.evidenceIds]),
    ],
    discrepancy: {
      statement: `系统发货记录与客户主张相差${difference}件。`,
      evidenceIds: [...new Set([...shipment.evidenceIds, ...claim.evidenceIds])],
    },
    uncertainties: [{
      statement: "当前证据不能确认客户实际签收数量。",
      evidenceIds: [],
    }],
    questionsToVerify: [
      "是否存在物流签收单或承运商 POD？",
      "是否存在承运商轨迹或客户确认记录？",
    ],
    prohibitedConclusions: [
      "不得认定仓库少发16件。",
      "不得认定客户实际只收到80件。",
      "不得认定责任归属。",
    ],
  };
}

function qualityOutput(input: GroundedExplanationInput): GroundedExplanationOutput {
  const inspected = observation(input, "qualityInspectedQty")!;
  const passed = observation(input, "qualityPassedQty")!;
  const nonconforming = metric(input, "nonconformingQty")!;
  const evidenceIds = [...new Set([...inspected.evidenceIds, ...passed.evidenceIds])];
  return {
    executiveSummary: `质检记录显示检验${inspected.value}件，合格${passed.value}件。确定性规则结果为存在${nonconforming}件未通过数量。当前证据不能证明其与发货差异存在因果关系。`,
    facts: [
      fact("source_fact", "inspectedQty", inspected.value, `质检记录显示检验${inspected.value}件。`, inspected.evidenceIds),
      fact("source_fact", "passedQty", passed.value, `质检合格数量为${passed.value}件。`, passed.evidenceIds),
      fact("metric", "nonconformingQty", nonconforming, `规则引擎检测到${nonconforming}件未通过数量。`, evidenceIds),
    ],
    discrepancy: {
      statement: `质检数量与合格数量存在${nonconforming}件未通过数量。`,
      evidenceIds,
    },
    uncertainties: [{
      statement: "当前证据不能证明质检未通过数量与发货差异之间存在因果关系。",
      evidenceIds: [],
    }],
    questionsToVerify: [
      "是否存在返工、报废或让步接收记录？",
      "是否存在生产批次与质检批次的对应记录？",
    ],
    prohibitedConclusions: [
      "不得认定质检未通过数量导致了发货少发。",
      "不得认定仓库少发。",
      "不得认定责任归属。",
    ],
  };
}

function genericOutput(input: GroundedExplanationInput): GroundedExplanationOutput {
  const facts: GroundedFact[] = [];
  for (const [key, value] of Object.entries(input.evaluation.observations)) {
    if (value.status !== "resolved" || typeof value.value !== "number") continue;
    const role = input.evidence.find((item) => value.evidenceIds.includes(item.evidenceId))?.role;
    const kind = role === "expected" ? "expected" : "actual";
    facts.push(fact(kind, key, value.value, `${key}为${value.value}。`, value.evidenceIds));
  }
  for (const [key, value] of Object.entries(input.evaluation.metrics)) {
    facts.push(fact("metric", key, value, `${key}为${value}。`, input.evidence.map((item) => item.evidenceId)));
  }
  const evidenceIds = [...new Set(input.evidence.map((item) => item.evidenceId))];
  return {
    executiveSummary: "确定性规则引擎已判定该异常成立。当前证据支持规则记录中的差异，尚需人工核验。",
    facts,
    discrepancy: {
      statement: "当前证据记录了规则计算所依据的差异。",
      evidenceIds,
    },
    uncertainties: [{
      statement: "当前证据仅支持规则结果，不能确认其他结论。",
      evidenceIds: [],
    }],
    questionsToVerify: ["是否需要补充独立证据确认当前差异？"],
    prohibitedConclusions: ["不得自动推断原因。", "不得自动判断责任。"],
  };
}

export class DeterministicGroundedAiProvider implements GroundedAiProvider {
  readonly name = "deterministic-demo";
  readonly model = "grounded-fixture-v1";

  async generate(request: GroundedAiRequest): Promise<GroundedExplanationOutput> {
    if (request.input.exception.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH") return customerClaimOutput(request.input);
    if (request.input.exception.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED") return qualityOutput(request.input);
    return genericOutput(request.input);
  }
}
