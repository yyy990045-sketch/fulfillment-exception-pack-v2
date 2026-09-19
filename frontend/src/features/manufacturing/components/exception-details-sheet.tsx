import { Info } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../components/ui/sheet.js";
import {
  useDecisionRecommendation,
  useGroundedExplanation,
  useOutcomeEvaluations,
  usePolicyEvaluations,
  useResolutionProcess,
  useRootCauseAnalysis,
} from "../../../hooks/use-manufacturing.js";
import type { ExceptionView, WorkbenchView } from "../types.js";
import { resolutionStatusLabel } from "../utils.js";

function DetailGroup({ title, rows }: { title: string; rows: Array<{ label: string; value: string | null | undefined }> }) {
  return (
    <section className="border-b border-border py-4 last:border-b-0">
      <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
      <dl className="mt-2 grid grid-cols-[130px_1fr] gap-x-4 gap-y-2 text-xs">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="contents">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="break-all font-mono">{row.value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ExceptionDetailsContent({
  contextId,
  exception,
  context,
  onOpenChange,
}: {
  contextId: string;
  exception: ExceptionView;
  context: WorkbenchView["context"];
  onOpenChange: (open: boolean) => void;
}) {
  const explanation = useGroundedExplanation(contextId, exception.id).detail.data?.explanation;
  const rootCause = useRootCauseAnalysis(contextId, exception.id).detail.data;
  const decision = useDecisionRecommendation(contextId, exception.id).detail.data;
  const policy = usePolicyEvaluations(contextId, exception.id).data?.evaluations?.at(-1);
  const resolution = useResolutionProcess(contextId, exception.id).detail.data;
  const outcomes = useOutcomeEvaluations(contextId, exception.id).data?.evaluations ?? [];
  const approvalEvent = resolution?.resolutionCase.runtime.events
    .filter((event) => event.to === "approved")
    .at(-1);
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>异常详情</SheetTitle>
          <SheetDescription>技术标识、来源、快照和审计信息</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DetailGroup title="履约上下文" rows={[
            { label: "Context ID", value: context.id },
            { label: "Context type", value: context.contextType },
            { label: "Opened at", value: context.openedAt },
            { label: "Updated at", value: context.updatedAt },
          ]} />
          <DetailGroup title="异常" rows={[
            { label: "Exception ID", value: exception.id },
            { label: "Exception code", value: exception.code },
            { label: "Rule ID", value: exception.ruleId },
            { label: "Rule version", value: exception.ruleVersionId },
            { label: "Rule evaluation", value: exception.latestRuleEvaluationId },
          ]} />
          {explanation && <DetailGroup title="AI 解释" rows={[
            { label: "Provider", value: explanation.provider },
            { label: "Model", value: explanation.model },
            { label: "Explanation ID", value: explanation.id },
            { label: "Snapshot hash", value: explanation.inputSnapshotHash },
            { label: "Created at", value: explanation.createdAt },
          ]} />}
          {rootCause && <DetailGroup title="根因假设" rows={[
            { label: "Provider", value: rootCause.provider },
            { label: "Model", value: rootCause.model },
            { label: "Analysis ID", value: rootCause.id },
            { label: "Snapshot hash", value: rootCause.inputSnapshotHash },
            { label: "Created at", value: rootCause.createdAt },
          ]} />}
          {decision && <DetailGroup title="决策建议" rows={[
            { label: "Provider", value: decision.provider },
            { label: "Model", value: decision.model },
            { label: "Recommendation ID", value: decision.id },
            { label: "Snapshot hash", value: decision.inputSnapshotHash },
            { label: "Created at", value: decision.createdAt },
            ...decision.output.options.flatMap((option, optionIndex) =>
              option.supportingFacts.flatMap((fact, factIndex) => [
                { label: `Fact ${optionIndex + 1}.${factIndex + 1} key`, value: fact.key },
                { label: `Fact ${optionIndex + 1}.${factIndex + 1} value`, value: String(fact.value) },
                { label: `Fact ${optionIndex + 1}.${factIndex + 1} evidence`, value: fact.evidenceIds.join(", ") },
              ]),
            ),
          ]} />}
          {policy && <DetailGroup title="策略评估" rows={[
            { label: "Evaluation ID", value: policy.id },
            { label: "Policy mode", value: policy.decision.mode },
            { label: "Snapshot hash", value: policy.policySnapshotHash },
            { label: "Evaluated by", value: policy.evaluatedBy },
          ]} />}
          {resolution && <DetailGroup title="治理与审批" rows={[
            { label: "Resolution ID", value: resolution.resolutionCase.id },
            { label: "Status", value: resolutionStatusLabel(resolution.resolutionCase.status) },
            { label: "Owner", value: resolution.resolutionCase.ownerRole },
            { label: "Accepted by", value: resolution.resolutionCase.origin.acceptedBy },
            { label: "Reviewed by", value: resolution.resolutionCase.review?.actor },
            { label: "Proposed by", value: resolution.resolutionCase.proposedBy },
            { label: "Approved by", value: approvalEvent?.actor ?? "审批角色未记录" },
            { label: "Approved at", value: approvalEvent?.at },
          ]} />}
          {resolution?.resolutionCase.runtime.actions.length ? <DetailGroup title="治理动作" rows={resolution.resolutionCase.runtime.actions.flatMap((action, index) => [
            { label: `Action ${index + 1} ID`, value: action.id },
            { label: `Action ${index + 1} type`, value: action.type },
            { label: `Action ${index + 1} status`, value: action.status },
            { label: `Action ${index + 1} summary`, value: action.summary },
          ])} /> : null}
          {resolution?.receipts.length ? <DetailGroup title="执行回执" rows={resolution.receipts.flatMap((receipt, index) => [
            { label: `Action ${index + 1}`, value: receipt.actionId },
            { label: `Source ${index + 1}`, value: receipt.receiptSource },
            { label: `Request ${index + 1}`, value: receipt.externalRequestId },
            { label: `Hash ${index + 1}`, value: receipt.payloadHash },
            { label: `Created at ${index + 1}`, value: receipt.createdAt },
          ])} /> : null}
          {outcomes.length ? <DetailGroup title="结果测量" rows={outcomes.flatMap((outcome, index) => [
            { label: `Outcome ${index + 1}`, value: outcome.id },
            { label: `Definition ${index + 1}`, value: `${outcome.definitionId}@${outcome.definitionVersion}` },
            { label: `Field ${index + 1}`, value: outcome.current.field },
            { label: `Snapshot ${index + 1}`, value: outcome.definitionSnapshotHash },
            { label: `Evaluated by ${index + 1}`, value: outcome.evaluatedBy },
            { label: `Evaluated at ${index + 1}`, value: outcome.evaluatedAt },
            { label: `Synthetic ${index + 1}`, value: String(outcome.syntheticEvidence) },
          ])} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ExceptionDetailsSheet({
  contextId,
  exception,
  context,
}: {
  contextId: string;
  exception: ExceptionView;
  context: WorkbenchView["context"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Info className="size-3.5" aria-hidden="true" />
        详情
      </Button>
      {open && (
        <ExceptionDetailsContent
          contextId={contextId}
          exception={exception}
          context={context}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
