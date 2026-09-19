import { CheckCircle2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "../../components/ui/button.js";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet.js";
import { useAccountContext, useGovernanceMutations } from "../../hooks/use-manufacturing.js";

type GovernanceMutations = ReturnType<typeof useGovernanceMutations>;

export type GovernanceActionName = keyof GovernanceMutations;

type GovernanceActionInput = {
  policy: { recommendationId: string; optionId: string };
  accept: { ownerRole: string; rationale: string };
  review: { caseId: string; decision: "confirm" | "needs_evidence" | "reject"; rationale: string };
  propose: { caseId: string; actions: Array<{ type: string; summary: string }> };
  submit: { caseId: string };
  approve: { caseId: string };
  execute: { caseId: string };
  close: { caseId: string };
};

const confirmationCopy: Partial<Record<GovernanceActionName, {
  title: string;
  action: string;
  risk: string;
  confirm: string;
}>> = {
  approve: {
    title: "确认批准方案",
    action: "批准当前治理方案",
    risk: "批准后方案将进入可执行状态。",
    confirm: "确认批准",
  },
  execute: {
    title: "确认执行方案",
    action: "执行已批准方案",
    risk: "执行后会登记内部回执，但不等于业务结果已经达成。",
    confirm: "确认执行",
  },
  close: {
    title: "确认核验并结案",
    action: "核验回执并结案",
    risk: "结案只表示治理流程完成，业务结果仍需以后续测量为准。",
    confirm: "确认结案",
  },
};

export const governanceActionSuccessMessages: Record<GovernanceActionName, string> = {
  policy: "处理资格已更新",
  accept: "已进入治理",
  review: "复核结论已提交",
  propose: "方案已保存",
  submit: "已提交审批",
  approve: "方案已批准",
  execute: "执行结果已登记",
  close: "治理已结案",
};

type ConfirmationState = {
  action: GovernanceActionName;
  input: GovernanceActionInput[GovernanceActionName];
  successMessage: string;
};

type GovernanceActionControllerValue = {
  mutations: GovernanceMutations;
  feedback: string | null;
  runAction: <K extends GovernanceActionName>(
    action: K,
    input: GovernanceActionInput[K],
    successMessage: string,
  ) => Promise<unknown>;
  requestAction: <K extends GovernanceActionName>(
    action: K,
    input: GovernanceActionInput[K],
    successMessage: string,
  ) => void;
};

const GovernanceActionControllerContext = createContext<GovernanceActionControllerValue | null>(null);

export function GovernanceActionControllerProvider({
  contextId,
  exceptionId,
  businessKey,
  exceptionLabel,
  children,
}: {
  contextId: string;
  exceptionId: string;
  businessKey: string;
  exceptionLabel: string;
  children: ReactNode;
}) {
  const mutations = useGovernanceMutations(contextId, exceptionId);
  const account = useAccountContext();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  const showFeedback = useCallback((message: string) => {
    setFeedback(message);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2600);
  }, []);

  const runAction = useCallback(async <K extends GovernanceActionName>(
    action: K,
    input: GovernanceActionInput[K],
    successMessage: string,
  ) => {
    let result: unknown;
    switch (action) {
      case "policy":
        result = await mutations.policy.run(input as GovernanceActionInput["policy"]);
        break;
      case "accept":
        result = await mutations.accept.run(input as GovernanceActionInput["accept"]);
        break;
      case "review":
        result = await mutations.review.run(input as GovernanceActionInput["review"]);
        break;
      case "propose":
        result = await mutations.propose.run(input as GovernanceActionInput["propose"]);
        break;
      case "submit":
        result = await mutations.submit.run(input as GovernanceActionInput["submit"]);
        break;
      case "approve":
        result = await mutations.approve.run(input as GovernanceActionInput["approve"]);
        break;
      case "execute":
        result = await mutations.execute.run(input as GovernanceActionInput["execute"]);
        break;
      case "close":
        result = await mutations.close.run(input as GovernanceActionInput["close"]);
        break;
    }
    if (result !== undefined) showFeedback(successMessage);
    return result;
  }, [mutations, showFeedback]);

  const requestAction = useCallback(<K extends GovernanceActionName>(
    action: K,
    input: GovernanceActionInput[K],
    successMessage: string,
  ) => {
    if (confirmationCopy[action]) {
      setConfirmation({ action, input, successMessage });
      return;
    }
    void runAction(action, input, successMessage);
  }, [runAction]);

  const confirmAction = async () => {
    if (!confirmation) return;
    const current = confirmation;
    await runAction(
      current.action,
      current.input as GovernanceActionInput[typeof current.action],
      current.successMessage,
    );
    setConfirmation(null);
  };

  const currentActor = account.data?.currentActor;
  const actorLabel = currentActor
    ? `${currentActor.user} · ${currentActor.roles.join("、") || "角色未记录"}`
    : "当前操作者";
  const copy = confirmation ? confirmationCopy[confirmation.action] : undefined;
  const pending = confirmation ? mutations[confirmation.action].mutation.isPending : false;

  return (
    <GovernanceActionControllerContext.Provider value={{ mutations, feedback, runAction, requestAction }}>
      {children}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 border border-success/25 bg-surface px-3 py-2 text-sm text-text-secondary shadow-sm"
        >
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          {feedback}
        </div>
      )}
      <Sheet open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !pending) setConfirmation(null); }}>
        {copy && (
          <SheetContent data-testid="governance-confirmation-sheet" className="max-w-[460px]">
            <SheetHeader>
              <SheetTitle>{copy.title}</SheetTitle>
              <SheetDescription>请确认本次高影响治理操作。</SheetDescription>
            </SheetHeader>
            <dl className="mt-5 divide-y divide-border border-y border-border text-sm">
              <div className="grid grid-cols-[110px_1fr] gap-3 py-3">
                <dt className="text-text-muted">业务对象</dt>
                <dd>{businessKey}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-3">
                <dt className="text-text-muted">当前异常</dt>
                <dd>{exceptionLabel}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-3">
                <dt className="text-text-muted">准备执行</dt>
                <dd>{copy.action}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-3">
                <dt className="text-text-muted">当前操作者</dt>
                <dd>{actorLabel}</dd>
              </div>
            </dl>
            <p className="mt-4 border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
              {copy.risk}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <SheetClose asChild>
                <Button variant="outline" disabled={pending}>取消</Button>
              </SheetClose>
              <Button disabled={pending} onClick={() => void confirmAction()}>
                {pending ? "正在处理..." : copy.confirm}
              </Button>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </GovernanceActionControllerContext.Provider>
  );
}

export function useGovernanceActionController() {
  const value = useContext(GovernanceActionControllerContext);
  if (!value) throw new Error("governance_action_controller_required");
  return value;
}
