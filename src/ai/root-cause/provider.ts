import type {
  RootCauseHypothesis,
  RootCauseInput,
  RootCauseOutput,
  RootCauseProvider,
  RootCauseRequest,
} from "./types.js";

function observation(input: RootCauseInput, key: string) {
  const item = input.evaluation.observations[key];
  return item?.status === "resolved" ? item : undefined;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hypothesis(
  id: string,
  statement: string,
  supportingEvidenceIds: string[],
  contradictingEvidenceIds: string[],
  missingEvidence: string[],
  verificationSteps: string[],
): RootCauseHypothesis {
  return {
    id,
    statement,
    epistemicStatus: "hypothesis",
    supportingEvidenceIds: unique(supportingEvidenceIds),
    contradictingEvidenceIds: unique(contradictingEvidenceIds),
    missingEvidence,
    verificationSteps,
  };
}

function customerClaimOutput(input: RootCauseInput): RootCauseOutput {
  const shipment = observation(input, "shipmentQty");
  const claim = observation(input, "claimedReceivedQty");
  return {
    summary: "当前证据只能确认发货记录与客户主张存在差异。差异可能发生在发货后至签收确认之间，需通过独立签收材料验证。",
    hypotheses: [
      hypothesis(
        "hypothesis-post-shipment-receipt-gap",
        "发货记录与客户主张之间的差异可能发生在发货后至签收确认之间，需要验证承运商签收、POD 与客户确认记录是否一致。",
        [...(shipment?.evidenceIds ?? []), ...(claim?.evidenceIds ?? [])],
        [],
        ["承运商 POD 或物流签收记录", "客户授权确认记录", "批次级发运明细"],
        ["核对发货批次的物流签收记录与 POD。", "核对客户实际签收确认时间和数量。", "确认是否存在分批到货或退货记录。"],
      ),
    ],
    uncertainties: ["当前证据不能确认实际签收数量、差异发生环节或责任归属。"],
    humanVerificationRequired: true,
    prohibitedConclusions: ["不得确认仓库少发。", "不得确认客户虚报。", "不得认定责任归属。"],
  };
}

function qualityOutput(input: RootCauseInput): RootCauseOutput {
  const inspected = observation(input, "qualityInspectedQty");
  const passed = observation(input, "qualityPassedQty");
  const shipment = observation(input, "shipmentQty");
  return {
    summary: "质检未通过数量与最终发货数量之间可能存在业务关联，但当前证据不足以确认因果关系。",
    hypotheses: [
      hypothesis(
        "hypothesis-quality-shipment-link",
        "质检未通过数量与最终发货数量之间可能存在业务关联，需要验证不合格品处置和仓储流转记录。",
        [...(inspected?.evidenceIds ?? []), ...(passed?.evidenceIds ?? []), ...(shipment?.evidenceIds ?? [])],
        [],
        ["不合格品处置记录", "返工、报废或让步接收记录", "生产与仓储流转记录"],
        ["核对4件不合格品的处置状态。", "核对质检批次与发运批次的对应关系。", "验证是否发生返工、补货或替代发运。"],
      ),
    ],
    uncertainties: ["当前证据不能证明质检未通过数量导致发货数量变化。"],
    humanVerificationRequired: true,
    prohibitedConclusions: ["不得确认4件不合格导致少发4件。", "不得认定仓库责任。", "不得认定责任归属。"],
  };
}

function paymentOutput(input: RootCauseInput): RootCauseOutput {
  const receivable = observation(input, "receivableAmount");
  const payment = observation(input, "paymentAmount");
  return {
    summary: "应收与回款差额可能与尚未完成付款或账期安排有关，需要核对合同账期与后续流水。",
    hypotheses: [
      hypothesis(
        "hypothesis-payment-timing-or-settlement",
        "应收与回款差额可能与尚未完成付款、分期安排或账期到期时间有关，需要核对合同账期及后续流水。",
        [...(receivable?.evidenceIds ?? []), ...(payment?.evidenceIds ?? [])],
        [],
        ["合同账期条款", "银行流水", "后续付款计划或争议记录"],
        ["核对合同约定账期与到期日。", "核对后续到账流水和付款方信息。", "确认是否存在折扣、扣款或争议金额。"],
      ),
    ],
    uncertainties: ["当前证据不能认定违约、坏账或无法回款。"],
    humanVerificationRequired: true,
    prohibitedConclusions: ["不得预测坏账。", "不得认定客户违约。", "不得认定责任归属。"],
  };
}

function genericOutput(input: RootCauseInput): RootCauseOutput {
  const evidenceIds = input.evidence.map((item) => item.evidenceId);
  return {
    summary: "当前证据支持存在需要进一步核验的业务差异，但不能确认原因或责任。",
    hypotheses: [
      hypothesis(
        "hypothesis-additional-context-required",
        "当前差异可能与尚未纳入当前证据范围的业务动作有关，需要补充跨系统流转记录进行验证。",
        evidenceIds,
        [],
        ["跨系统流转记录", "人工操作记录", "后续处置记录"],
        ["核对相关业务实体的状态变化。", "补充来源系统之间的对账记录。"],
      ),
    ],
    uncertainties: ["当前证据不足以确认原因。"],
    humanVerificationRequired: true,
    prohibitedConclusions: ["不得自动确认根因。", "不得认定责任归属。"],
  };
}

export class DeterministicRootCauseProvider implements RootCauseProvider {
  readonly name = "root-cause-deterministic-demo";
  readonly model = "root-cause-fixture-v1";

  async generate(request: RootCauseRequest): Promise<RootCauseOutput> {
    if (request.input.exception.code === "CUSTOMER_RECEIPT_CLAIM_MISMATCH") return customerClaimOutput(request.input);
    if (request.input.exception.code === "QUALITY_NONCONFORMING_QUANTITY_DETECTED") return qualityOutput(request.input);
    if (request.input.exception.code === "PAYMENT_BALANCE_OUTSTANDING") return paymentOutput(request.input);
    return genericOutput(request.input);
  }
}
