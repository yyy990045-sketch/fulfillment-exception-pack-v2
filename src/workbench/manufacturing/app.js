const DEFAULT_CONTEXT_ID = "ctx-so-mfg-001";
const DEFAULT_TENANT_ID = "demo-manufacturing";
const params = new URLSearchParams(window.location.search);
const contextId = params.get("context") || DEFAULT_CONTEXT_ID;

const DEMO_ACTORS = {
  "sales-director": { name: "销售总监", canApprove: true },
  "quality-owner": { name: "品质负责人", canApprove: false },
  engineer: { name: "工程师", canApprove: true },
  finance: { name: "财务", canApprove: true },
  "general-manager": { name: "总经理", canApprove: true },
  admin: { name: "管理员", canApprove: true },
};

const ACTION_TYPES = {
  supplement_evidence: "补充核验证据",
  urge_follow_up: "催办业务跟进",
  reject_overclaim: "驳回无依据超额主张",
  review_quotation: "复核报价与订单",
  create_task: "创建跟进任务",
};

const ACTION_STATUS = {
  draft: "草案",
  pending_approval: "等待审批",
  authorized: "已授权",
  succeeded: "执行成功",
  verified: "已核验",
  failed: "执行失败",
};

const ERROR_MESSAGES = {
  actor_required: "请选择演示操作人。",
  scope_forbidden: "当前身份没有执行该操作的权限。",
  SEGREGATION_OF_DUTIES_VIOLATION: "复核/方案提出人与审批人必须分离。",
  resolution_review_not_allowed: "当前状态不能再次复核。",
  resolution_proposal_not_allowed: "当前状态不能拟定处置方案。",
  resolution_submit_not_allowed: "当前状态不能提交审批。",
  resolution_approval_not_submitted: "方案尚未提交审批。",
  resolution_approval_not_allowed: "当前状态不能审批。",
  resolution_execution_not_allowed: "方案尚未批准，不能执行。",
  resolution_close_not_allowed: "尚未完成执行，不能结案。",
  receipt_required: "执行结果尚未完整登记，不能结案。",
  RESOLUTION_EXECUTION_IDEMPOTENCY_CONFLICT: "本次执行请求与已记录执行不一致。",
};

const state = {
  view: null,
  selectedExceptionId: null,
  activeTab: "evidence",
  bundle: null,
  explanations: [],
  decisionRecommendations: [],
  decisionDispositions: [],
  selectedDecision: null,
  decisionDraft: null,
  resolution: null,
  resolutionMutating: false,
  demoTenantId: DEFAULT_TENANT_ID,
  demoActorId: window.localStorage.getItem("demoActorId") || "quality-owner",
};
if (!DEMO_ACTORS[state.demoActorId]) state.demoActorId = "quality-owner";

const roleLabels = {
  expected: "规则期望",
  actual: "系统记录",
  claim: "客户主张",
  context: "上下文证据",
};

const severityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function clear(element) {
  element.replaceChildren();
}

function setText(element, value) {
  element.textContent = value === undefined || value === null ? "" : String(value);
}

function button(label, className, onClick) {
  const element = node("button", `button ${className || ""}`.trim(), label);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

function hasBearerToken() {
  return Boolean(window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken"));
}

function requestHeaders(method, hasBody = false) {
  const headers = { accept: "application/json" };
  const token = window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken");
  if (token) {
    headers.authorization = `Bearer ${token}`;
    if (hasBody) headers["content-type"] = "application/json";
    return headers;
  }
  headers["x-tenant-id"] = state.demoTenantId;
  if (method !== "GET") headers["x-actor"] = state.demoActorId;
  if (hasBody) headers["content-type"] = "application/json";
  return headers;
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method,
    headers: requestHeaders(method, hasBody),
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `http_${response.status}`);
    error.status = response.status;
    error.payload = body;
    throw error;
  }
  return body;
}

function friendlyError(error) {
  return ERROR_MESSAGES[error.message] || (error.status === 403 ? "当前身份没有执行该操作的权限。" : error.message || "操作失败。");
}

function showState(message, error = false) {
  const banner = document.getElementById("state-banner");
  banner.textContent = message;
  banner.classList.add("visible");
  banner.classList.toggle("error", error);
}

function clearState() {
  const banner = document.getElementById("state-banner");
  banner.textContent = "";
  banner.classList.remove("visible", "error");
}

function formatValue(fact) {
  if (fact.value === null || fact.value === undefined) return "—";
  if (typeof fact.value !== "number") return String(fact.value);
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(fact.value);
  return fact.valueType === "currency" && !formatted.includes("¥") ? `¥${formatted}` : formatted;
}

function metricSummary(metrics) {
  if (!metrics || typeof metrics !== "object") return "";
  if (typeof metrics.difference === "number") return `差异 ${metrics.difference}`;
  if (typeof metrics.outstandingAmount === "number") return `未结清 ${metrics.outstandingAmount}`;
  if (typeof metrics.shortfall === "number") return `短少 ${metrics.shortfall}`;
  if (typeof metrics.nonconformingQty === "number") return `未通过 ${metrics.nonconformingQty}`;
  const first = Object.entries(metrics)[0];
  return first ? `${first[0]} ${first[1]}` : "";
}

function renderContext(view) {
  setText(document.getElementById("header-business-key"), view.context.businessKey);
  setText(document.getElementById("header-context-id"), view.context.id);
  setText(document.getElementById("context-title"), `${view.context.businessKey} 制造履约上下文`);
  setText(document.getElementById("context-status"), view.context.status === "active" ? "履约进行中" : view.context.status);
  setText(document.getElementById("context-description"), "报价、订单、生产、质检、发货、资金和客诉已归并到同一履约上下文。");
  setText(
    document.getElementById("context-meta"),
    `${view.stats.sourceSystems} 个来源系统 · ${view.stats.entities} 个业务实体 · ${view.stats.events} 个业务事件 · ${view.stats.ruleEvaluations} 条规则 · ${view.stats.exceptions} 个当前异常`,
  );
}

function renderTruthStrip(view) {
  const strip = document.getElementById("truth-strip");
  clear(strip);
  strip.append(node("span", "", "当前演示边界"));
  const labels = {
    manufacturingFacts: "Manufacturing Facts",
    ruleEngine: "Rule Engine",
    groundedAi: "Grounded AI",
    openSupOSRuntime: "Open supOS Runtime",
    openAiApi: "OpenAI API",
  };
  for (const [key, value] of Object.entries(view.truthfulness || {})) {
    strip.append(node("strong", "", `${labels[key] || key}: ${value}`));
  }
}

function ruleChip(rule) {
  const chip = node("span", `rule-chip ${rule.status}`, `${rule.matched ? "!" : "✓"} ${rule.label}`);
  chip.title = rule.code;
  return chip;
}

function renderThread(view) {
  const track = document.getElementById("thread-track");
  clear(track);
  for (const stage of view.thread) {
    const card = node("article", "thread-node");
    card.dataset.state = stage.state;
    card.setAttribute("aria-label", `${stage.label} ${stage.businessKey} ${stage.state === "exception" ? "存在异常" : "正常"}`);
    const head = node("div", "thread-node-head");
    head.append(node("strong", "stage-name", stage.label), node("i", "stage-state"));
    card.append(head, node("span", "stage-key", stage.businessKey));
    const facts = node("div", "stage-facts");
    for (const fact of stage.facts) {
      const item = node("div", "stage-fact");
      item.append(node("span", "fact-label", fact.label), node("strong", "fact-value", formatValue(fact)));
      facts.append(item);
    }
    card.append(facts);
    if (stage.sourceSystem) card.append(node("small", "stage-source", `来源 ${stage.sourceSystem.id}`));
    const rules = view.rules.filter((rule) => rule.stageKeys.includes(stage.key));
    if (rules.length) {
      const row = node("div", "rule-chip-row");
      for (const rule of rules) row.append(ruleChip(rule));
      card.append(row);
    }
    track.append(card);
  }
}

function renderExceptions(view) {
  const list = document.getElementById("exception-list");
  clear(list);
  setText(document.getElementById("exception-count"), view.exceptions.length);
  for (const exception of view.exceptions) {
    const item = node("button", "exception-item");
    item.type = "button";
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-pressed", String(exception.id === state.selectedExceptionId));
    item.append(node("strong", "exception-title", exception.label), node("span", "exception-code", exception.code));
    const meta = node("div", "exception-meta");
    meta.append(
      node("span", `severity ${exception.severity}`, severityLabels[exception.severity] || exception.severity),
      node("span", "", metricSummary(exception.metrics)),
    );
    item.append(meta);
    item.addEventListener("click", () => selectException(exception.id));
    list.append(item);
  }
}

function renderSelectedException() {
  const exception = state.view?.exceptions.find((item) => item.id === state.selectedExceptionId);
  const heading = document.getElementById("detail-heading");
  const meta = document.getElementById("detail-meta");
  if (!exception) {
    setText(heading, "异常明细");
    setText(meta, "");
    return;
  }
  setText(heading, exception.label);
  setText(meta, `${exception.ruleVersionId} · ${exception.evidenceCount} 条证据 · ${exception.sourceSystemCount} 个来源系统 · ${exception.status}`);
}

function clearPanels() {
  for (const id of ["panel-evidence", "panel-ai", "panel-decision", "panel-resolution"]) clear(document.getElementById(id));
}

function renderLoadingPanel(id) {
  const panel = document.getElementById(id);
  clear(panel);
  panel.append(node("div", "skeleton"));
}

function renderEmptyPanel(id, message) {
  const panel = document.getElementById(id);
  clear(panel);
  panel.append(node("div", "empty-state", message));
}

function evidenceSourceLabel(bundle, evidence) {
  const system = bundle.sourceSystems.find((item) => item.id === evidence.sourceSystemId);
  const document = bundle.sourceDocuments.find((item) => item.id === evidence.sourceDocumentId);
  const parts = [system?.name || evidence.sourceSystemId];
  if (document) parts.push(`${document.externalDocumentId} / ${document.version}`);
  return parts.join(" · ");
}

function renderEvidence(bundle) {
  const panel = document.getElementById("panel-evidence");
  clear(panel);
  const head = node("div", "exception-detail-head");
  const left = node("div");
  left.append(node("h3", "", "事实与证据"), node("p", "", "规则判断只使用下方已登记的 Evidence，不从其他上下文推断。"));
  head.append(left);
  panel.append(head);
  const grid = node("div", "evidence-grid");
  for (const evidence of bundle.evidence) {
    const card = node("article", "evidence-card");
    card.dataset.evidenceId = evidence.evidenceId;
    card.append(
      node("span", "evidence-role", roleLabels[evidence.role] || evidence.role),
      node("strong", "evidence-value", typeof evidence.value === "number" ? new Intl.NumberFormat("zh-CN").format(evidence.value) : String(evidence.value)),
      node("span", "evidence-source", evidenceSourceLabel(bundle, evidence)),
      node("p", "evidence-quote", evidence.quote || "—"),
    );
    const meta = node("div", "evidence-meta");
    meta.append(
      node("span", "", `字段 ${evidence.field}`),
      node("span", "", `事件 ${evidence.eventId || "—"}`),
      node("span", "", `时间 ${evidence.observedAt}`),
      node("span", "", `support ${evidence.support}`),
    );
    card.append(meta);
    grid.append(card);
  }
  panel.append(grid);
  if (bundle.evidence.some((item) => item.role === "claim")) {
    panel.append(node("p", "evidence-quote", "当前可以确认：两份记录存在差异。当前不能确认：客户实际签收数量。"));
  }
}

function citationButtons(evidenceIds) {
  const row = node("div");
  for (const evidenceId of evidenceIds || []) {
    const element = node("button", "citation-button", evidenceId);
    element.type = "button";
    element.addEventListener("click", () => switchTab("evidence", evidenceId));
    row.append(element, document.createTextNode(" "));
  }
  return row;
}

function renderExplanation(explanation) {
  const panel = document.getElementById("panel-ai");
  clear(panel);
  const output = explanation.output || {};
  const providerLabel = explanation.provider === "deterministic-demo" ? "演示解释器" : explanation.provider === "openai" ? "OpenAI" : explanation.provider;
  const meta = node("div", "explanation-meta");
  meta.append(node("span", "provider-badge", providerLabel), node("span", "provider-badge", explanation.model), node("span", "provider-badge", explanation.createdAt));
  if (explanation.stale) meta.append(node("span", "provider-badge stale", "该解释基于旧证据快照，请以当前 Evidence 为准。"));
  panel.append(meta, node("p", "explanation-summary", output.executiveSummary || ""));
  for (const [title, items] of [["事实", output.facts || []], ["尚不确定", output.uncertainties || []]]) {
    const section = node("section", "explanation-block");
    section.append(node("h4", "", title));
    const list = node("ul", "explanation-list");
    for (const item of items) {
      const row = node("li");
      row.append(node("span", "", `${item.statement} `), citationButtons(item.evidenceIds));
      list.append(row);
    }
    section.append(list);
    panel.append(section);
  }
  const questions = node("section", "explanation-block");
  questions.append(node("h4", "", "待核验问题"));
  const questionList = node("ul", "explanation-list");
  for (const question of output.questionsToVerify || []) questionList.append(node("li", "", question));
  questions.append(questionList);
  panel.append(questions);
}

function renderAIPanel(explanations) {
  if (!explanations.length) {
    renderEmptyPanel("panel-ai", "尚未生成基于当前证据快照的解释。");
    return;
  }
  renderExplanation(explanations[0]);
}

function decisionOptionCard(option, recommended) {
  const card = node("article", "evidence-card");
  card.append(
    node("span", "evidence-role", recommended ? "推荐方案" : "备选方案"),
    node("span", "provider-badge", ACTION_TYPES[option.actionType] || option.actionType),
    node("strong", "exception-title", option.title),
    node("p", "explanation-summary", option.actionSummary),
    node("p", "evidence-quote", option.rationale),
  );
  const facts = node("div", "evidence-meta");
  for (const fact of option.supportingFacts || []) facts.append(node("span", "", `${fact.key} = ${fact.value}`));
  card.append(facts);
  if (option.historyClaims?.length) {
    const history = node("div", "evidence-meta");
    for (const claim of option.historyClaims) history.append(node("span", "", claim.statement));
    card.append(history);
  }
  if (option.assumptions?.length) card.append(node("div", "inline-notice", `前提假设：${option.assumptions.join("、")}`));
  if (option.missingEvidence?.length) card.append(node("div", "inline-notice", `缺失材料：${option.missingEvidence.join("、")}`));
  if (option.evidenceIds?.length) card.append(citationButtons(option.evidenceIds));
  return card;
}

async function submitDecisionDisposition(recommendationId, decision, selectedOptionId, rationale) {
  const path = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(state.selectedExceptionId)}/decision-recommendations/${encodeURIComponent(recommendationId)}/dispositions`;
  await api(path, { method: "POST", body: { decision, selectedOptionId, rationale } });
  showState("决策建议反馈已记录。");
  await selectException(state.selectedExceptionId);
  switchTab("decision");
}

function renderDecisionPanel(recommendations, dispositions = []) {
  const panel = document.getElementById("panel-decision");
  clear(panel);
  if (!recommendations.length) {
    panel.append(node("div", "empty-state", "尚未基于当前证据与历史治理记录生成决策建议。"));
    panel.append(button("生成决策建议", "", async () => {
      showState("正在生成决策建议...");
      try {
        const result = await api(`/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(state.selectedExceptionId)}/decision-recommendations`, { method: "POST", body: {} });
        await selectException(state.selectedExceptionId);
        switchTab("decision");
        showState(result.status === "rejected" ? "决策建议已被 Grounding Guard 拒绝。" : "决策建议已生成。");
      } catch (error) {
        const recommendation = error.payload?.recommendation;
        if (recommendation) {
          state.decisionRecommendations = [recommendation];
          renderDecisionPanel([recommendation]);
          showState("决策建议已被 Grounding Guard 拒绝。", true);
        } else showState(friendlyError(error), true);
      }
    }));
    return;
  }
  const recommendation = recommendations[0];
  state.selectedDecision = recommendation;
  const meta = node("div", "explanation-meta");
  meta.append(
    node("span", "provider-badge", recommendation.provider === "decision-deterministic-demo" ? "演示决策器" : recommendation.provider),
    node("span", "provider-badge", recommendation.model),
    node("span", "provider-badge", recommendation.createdAt),
    node("span", "provider-badge", recommendation.status),
  );
  if (recommendation.stale) meta.append(node("span", "provider-badge stale", "该建议基于旧证据或旧历史快照，请以当前事实为准。"));
  panel.append(meta);
  panel.append(node("p", "explanation-summary", recommendation.output.executiveSummary));
  if (recommendation.status === "rejected") {
    panel.append(node("div", "inline-notice error", "该建议未通过 Grounding 与 Action Eligibility 校验，仅保留审计记录，不能用于人工方案草稿。"));
    const errors = node("section", "explanation-block");
    errors.append(node("h4", "", "校验未通过"));
    const list = node("ul", "explanation-list");
    const validation = recommendation.validation || {};
    for (const [key, items] of [
      ["引用", validation.citationErrors || []],
      ["数值", validation.numericErrors || []],
      ["历史", validation.historyErrors || []],
      ["动作边界", validation.eligibilityErrors || []],
      ["不支持结论", validation.unsupportedClaims || []],
      ["结构", validation.schemaErrors || []],
    ]) {
      if (items.length) list.append(node("li", "", `${key}：${items.join("、")}`));
    }
    errors.append(list);
    panel.append(errors);
    return;
  }
  const note = node("div", "inline-notice");
  note.append(node("strong", "", "历史信号"), node("span", "", "历史动作次数仅表示过去的治理记录，不代表方案有效性或成功率。"));
  panel.append(note);
  const options = node("div", "evidence-grid");
  for (const option of recommendation.output.options) options.append(decisionOptionCard(option, option.id === recommendation.output.recommendedOptionId));
  panel.append(options);
  if (recommendation.output.uncertainties?.length) {
    const uncertainty = node("section", "explanation-block");
    uncertainty.append(node("h4", "", "尚不确定"));
    const list = node("ul", "explanation-list");
    for (const item of recommendation.output.uncertainties) list.append(node("li", "", item));
    uncertainty.append(list);
    panel.append(uncertainty);
  }

  const disposition = node("form", "governance-form");
  disposition.append(node("h4", "", "人工反馈"));
  const optionRow = node("div", "form-row");
  optionRow.append(node("label", "", "关注方案"));
  const select = node("select");
  for (const option of recommendation.output.options) {
    const item = node("option", "", option.title);
    item.value = option.id;
    select.append(item);
  }
  select.value = recommendation.output.recommendedOptionId;
  optionRow.append(select);
  const rationaleRow = node("div", "form-row");
  rationaleRow.append(node("label", "", "反馈说明"));
  const rationale = node("textarea");
  rationale.placeholder = "说明认可、修改或不采纳该建议的原因。";
  rationaleRow.append(rationale);
  disposition.append(optionRow, rationaleRow);
  const actions = node("div", "form-actions");
  for (const [decision, label] of [["accepted", "认可建议"], ["modified", "需要修改"], ["rejected", "不采纳"]]) {
    actions.append(button(label, decision === "rejected" ? "danger" : "secondary", async () => {
      if (!rationale.value.trim()) return showState("反馈说明不能为空。", true);
      try {
        await submitDecisionDisposition(recommendation.id, decision, decision === "rejected" ? undefined : select.value, rationale.value.trim());
      } catch (error) {
        showState(friendlyError(error), true);
      }
    }));
  }
  disposition.append(actions);
  disposition.addEventListener("submit", (event) => event.preventDefault());
  panel.append(disposition);

  if (recommendation.status === "generated" && state.resolution?.query?.resolutionCase?.status === "confirmed") {
    panel.append(button("填入人工方案草稿", "", () => {
      const selected = recommendation.output.options.find((option) => option.id === select.value) ?? recommendation.output.options[0];
      state.decisionDraft = { type: selected.actionType, summary: selected.actionSummary };
      switchTab("resolution");
      renderResolution(state.resolution.query);
    }));
  }
  if (dispositions.length) {
    const history = node("section", "explanation-block");
    history.append(node("h4", "", "人工反馈记录"));
    const list = node("ul", "explanation-list");
    for (const item of dispositions) list.append(node("li", "", `${item.decision} · ${item.selectedOptionId || "—"} · ${item.actor} · ${item.createdAt}`));
    history.append(list);
    panel.append(history);
  }
}

async function loadDecision(exceptionId) {
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}/decision-recommendations`;
  const result = await api(base);
  const summaries = result.recommendations || [];
  const latest = summaries.at(-1);
  if (!latest) {
    state.decisionRecommendations = [];
    state.selectedDecision = null;
    renderDecisionPanel([]);
    return;
  }
  state.selectedDecision = await api(`${base}/${encodeURIComponent(latest.id)}`);
  state.decisionRecommendations = [state.selectedDecision];
  const dispositions = await api(`${base}/${encodeURIComponent(latest.id)}/dispositions`).catch(() => ({ dispositions: [] }));
  renderDecisionPanel(state.decisionRecommendations, dispositions.dispositions || []);
}

function governanceSteps(resolutionCase) {
  const status = resolutionCase?.status;
  const actions = resolutionCase?.runtime?.actions || [];
  if (!resolutionCase) return ["current", "pending", "pending", "pending", "pending", "pending"];
  if (status === "triaged") return ["done", "current", "pending", "pending", "pending", "pending"];
  if (status === "confirmed") return ["done", "done", "current", "pending", "pending", "pending"];
  if (status === "rejected") return ["done", "done", "pending", "pending", "pending", "pending"];
  if (status === "proposed") {
    const submitted = actions.length > 0 && actions.every((action) => action.status === "pending_approval");
    return submitted
      ? ["done", "done", "done", "current", "pending", "pending"]
      : ["done", "done", "current", "pending", "pending", "pending"];
  }
  if (status === "approved") return ["done", "done", "done", "done", "current", "pending"];
  if (status === "executed") return ["done", "done", "done", "done", "done", "current"];
  if (status === "closed") return ["done", "done", "done", "done", "done", "done"];
  return ["pending", "pending", "pending", "pending", "pending", "pending"];
}

function renderProgress(resolutionCase) {
  const labels = ["进入处置", "复核", "方案", "审批", "执行", "核验结案"];
  const steps = governanceSteps(resolutionCase);
  const row = node("div", "governance-progress");
  labels.forEach((label, index) => row.append(node("div", `governance-step ${steps[index]}`, label)));
  return row;
}

function actionList(resolutionCase) {
  const section = node("section", "explanation-block");
  section.append(node("h4", "", "Actions"));
  const list = node("ul", "explanation-list");
  for (const action of resolutionCase.runtime?.actions || []) {
    list.append(node("li", "", `${ACTION_TYPES[action.type] || action.type} · ${action.summary} · ${ACTION_STATUS[action.status] || action.status}`));
  }
  section.append(list);
  return section;
}

function receiptList(receipts) {
  if (!receipts?.length) return null;
  const section = node("section", "explanation-block");
  section.append(node("h4", "", "本地演示能力台账回执"));
  const list = node("ul", "explanation-list");
  for (const receipt of receipts) {
    const hash = receipt.payloadHash ? `${receipt.payloadHash.slice(0, 12)}…` : "—";
    list.append(node("li", "", `${receipt.actionId} · ${receipt.status} · ${receipt.externalRequestId} · ${receipt.receiptSource} · ${receipt.createdAt} · ${hash}`));
  }
  section.append(list);
  return section;
}

function auditTimeline(events) {
  const section = node("section", "explanation-block");
  section.append(node("h4", "", "审计轨迹"));
  const list = node("div", "audit-list");
  for (const event of events || []) {
    const row = node("div", "audit-item");
    row.append(
      node("time", "", event.at || ""),
      node("strong", "", event.actor || "system"),
      node("span", "", `${event.from || "—"} → ${event.to || "—"} · ${event.reason || ""}`),
    );
    list.append(row);
  }
  section.append(list);
  return section;
}

function snapshotGrid(query) {
  const resolutionCase = query.resolutionCase;
  const grid = node("div", "resolution-grid");
  const items = [
    ["Case ID", resolutionCase.id],
    ["处置负责人", resolutionCase.ownerRole],
    ["Accepted By", resolutionCase.origin.acceptedBy],
    ["Accepted At", resolutionCase.origin.acceptedAt],
    ["Acceptance Rationale", resolutionCase.origin.acceptanceRationale],
    ["Source Rule Evaluation", resolutionCase.origin.sourceRuleEvaluationId],
    ["Intake Evaluation", query.intakeEvaluationId],
    ["Current Evaluation", query.currentEvaluationId],
    ["Source Exception Status", query.sourceException?.status],
    ["Evidence Refs", (resolutionCase.origin.evidenceRefs || []).map((item) => `${item.evidenceId} (${item.role})`).join("、") || "—"],
  ];
  for (const [label, value] of items) {
    const item = node("div", "resolution-item");
    item.append(node("span", "", label), node("strong", "", value));
    grid.append(item);
  }
  return grid;
}

function actionEditor(initialAction) {
  const editor = node("div", "action-editor");
  const addRow = () => {
    if (editor.querySelectorAll(".action-row").length >= 3) return;
    const row = node("div", "action-row");
    const select = node("select");
    for (const [value, label] of Object.entries(ACTION_TYPES)) {
      const option = node("option", "", label);
      option.value = value;
      select.append(option);
    }
    const summary = node("textarea");
    summary.placeholder = "说明这项动作要做什么，以及完成标准。";
    if (initialAction && editor.querySelectorAll(".action-row").length === 0) {
      select.value = initialAction.type;
      summary.value = initialAction.summary || "";
    }
    const remove = button("移除", "secondary", () => row.remove());
    row.append(select, summary, remove);
    editor.append(row);
  };
  addRow();
  return {
    element: editor,
    add: addRow,
    values() {
      return [...editor.querySelectorAll(".action-row")].map((row) => ({
        type: row.querySelector("select").value,
        summary: row.querySelector("textarea").value.trim(),
      })).filter((item) => item.summary);
    },
  };
}

function renderNoResolution() {
  const panel = document.getElementById("panel-resolution");
  clear(panel);
  const exception = state.view.exceptions.find((item) => item.id === state.selectedExceptionId);
  panel.append(renderProgress(null));
  const gate = node("div", "gate-card");
  const copy = node("div");
  copy.append(node("h3", "", "当前闸门：进入人工处置"), node("p", "", "该异常尚未进入人工处置。进入后会保留 intake lineage 与 Evidence references。"));
  gate.append(copy, node("span", "gate-tag", "待人工操作"));
  panel.append(gate);
  const grid = node("div", "resolution-grid");
  for (const [label, value] of [
    ["当前 Exception", exception?.label],
    ["最新 Rule Evaluation", exception?.latestRuleEvaluationId],
    ["Evidence Count", exception?.evidenceCount],
    ["Source Systems", exception?.sourceSystemCount],
  ]) {
    const item = node("div", "resolution-item");
    item.append(node("span", "", label), node("strong", "", value));
    grid.append(item);
  }
  panel.append(grid);
  panel.append(button("进入人工处置", "", () => renderAcceptanceForm()));
}

function renderAcceptanceForm() {
  const panel = document.getElementById("panel-resolution");
  clear(panel);
  panel.append(renderProgress(null));
  const form = node("form", "governance-form");
  form.append(node("h4", "", "进入人工处置"));
  const ownerRow = node("div", "form-row");
  ownerRow.append(node("label", "", "处置负责人角色"));
  const owner = node("select");
  for (const role of ["品质负责人", "销售总监", "工程师", "财务", "总经理", "管理员"]) {
    const option = node("option", "", role);
    option.value = role;
    owner.append(option);
  }
  ownerRow.append(owner);
  const rationaleRow = node("div", "form-row");
  rationaleRow.append(node("label", "", "进入处置原因"));
  const rationale = node("textarea");
  rationale.placeholder = "当前记录存在数量差异，需要进入人工核验与处置流程。";
  rationaleRow.append(rationale);
  const actions = node("div", "form-actions");
  actions.append(
    button("确认进入处置", "", async () => {
      if (!rationale.value.trim()) return showState("进入处置原因不能为空。", true);
      await mutate(`/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(state.selectedExceptionId)}/resolution-case`, { ownerRole: owner.value, rationale: rationale.value.trim() }, "已进入人工处置。");
    }),
    button("返回", "secondary", () => renderNoResolution()),
  );
  form.append(ownerRow, rationaleRow, actions);
  form.addEventListener("submit", (event) => event.preventDefault());
  panel.append(form);
}

function renderReviewForm() {
  const form = node("form", "governance-form");
  form.append(node("h4", "", "人工复核"));
  const decisionRow = node("div", "form-row");
  decisionRow.append(node("label", "", "复核结论"));
  const decision = node("select");
  for (const [value, label] of [["confirm", "确认进入处置"], ["needs_evidence", "仍需补充材料"], ["reject", "不继续处置"]]) {
    const option = node("option", "", label);
    option.value = value;
    decision.append(option);
  }
  decisionRow.append(decision);
  const rationaleRow = node("div", "form-row");
  rationaleRow.append(node("label", "", "复核说明"));
  const rationale = node("textarea");
  rationale.placeholder = "说明复核依据，以及为什么选择当前结论。";
  rationaleRow.append(rationale);
  form.append(decisionRow, rationaleRow);
  form.append(button("提交复核", "", async () => {
    if (!rationale.value.trim()) return showState("复核说明不能为空。", true);
    if (decision.value === "reject" && !window.confirm("确认终止该异常的人工处置流程？")) return;
    await mutate(`/api/v2/resolution-cases/${encodeURIComponent(state.resolution.query.resolutionCase.id)}/review`, { decision: decision.value, rationale: rationale.value.trim() }, decision.value === "needs_evidence" ? "当前仍需补充材料，尚未进入方案阶段。" : "复核结果已登记。");
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function renderProposalForm() {
  const form = node("form", "governance-form");
  form.append(node("h4", "", "人工处置方案"));
  const editor = actionEditor(state.decisionDraft);
  if (state.decisionDraft) form.append(node("div", "inline-notice info", "内容来源于 AI Recommendation，提交前请人工核对和修改。"));
  form.append(editor.element, button("增加动作", "secondary", () => editor.add()));
  form.append(button("拟定方案", "", async () => {
    const actions = editor.values();
    if (!actions.length) return showState("至少填写一项处置动作及说明。", true);
    await mutate(`/api/v2/resolution-cases/${encodeURIComponent(state.resolution.query.resolutionCase.id)}/propose`, { actions }, "方案已拟定，尚未提交审批。");
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function renderProposed(query) {
  const resolutionCase = query.resolutionCase;
  const actions = resolutionCase.runtime.actions || [];
  const pending = actions.length > 0 && actions.every((action) => action.status === "pending_approval");
  const draft = actions.length > 0 && actions.every((action) => action.status === "draft");
  const container = node("div");
  container.append(actionList(resolutionCase));
  if (draft) container.append(button("提交审批", "", () => mutate(`/api/v2/resolution-cases/${encodeURIComponent(resolutionCase.id)}/submit`, {}, "方案已提交，等待独立审批人确认。")));
  if (pending) {
    const sod = node("div", "inline-notice");
    sod.append(node("strong", "", "Segregation of Duties"), node("span", "", `复核人：${resolutionCase.review?.actor || "—"}；方案提出人：${resolutionCase.proposedBy || "—"}。审批必须由不同人员完成。`));
    container.append(sod);
    const actor = DEMO_ACTORS[state.demoActorId];
    const demoNames = new Set([resolutionCase.review?.actor, resolutionCase.proposedBy].filter(Boolean));
    const conflict = !hasBearerToken() && demoNames.has(actor?.name);
    const roleForbidden = !hasBearerToken() && !actor?.canApprove;
    const canApprove = !conflict && !roleForbidden;
    if (!canApprove) container.append(node("div", "inline-notice error", conflict ? "当前身份不能审批该方案，请切换独立审批人。" : "当前身份没有审批权限，请切换具备审批角色的演示身份。"));
    const approve = button("批准方案", "", async () => {
      if (!window.confirm("确认批准该处置方案？")) return;
      await mutate(`/api/v2/resolution-cases/${encodeURIComponent(resolutionCase.id)}/approve`, {}, "方案已获批准。");
    });
    approve.disabled = !canApprove;
    container.append(approve);
  }
  return container;
}

function renderExecuted(query) {
  const resolutionCase = query.resolutionCase;
  const container = node("div");
  container.append(actionList(resolutionCase));
  const receipts = receiptList(query.receipts);
  if (receipts) container.append(receipts);
  if (resolutionCase.status === "executed") {
    container.append(button("核验并结案", "", async () => {
      if (!window.confirm("核验所有已批准动作均有执行结果后结案？")) return;
      await mutate(`/api/v2/resolution-cases/${encodeURIComponent(resolutionCase.id)}/close`, {}, "处置已结案；原异常事实与证据仍保留用于审计。");
    }));
  } else {
    container.append(node("div", "inline-notice info", "处置流程已完成；原异常事实与证据仍保留用于审计。"));
  }
  return container;
}

function renderResolution(query) {
  const panel = document.getElementById("panel-resolution");
  clear(panel);
  const resolutionCase = query.resolutionCase;
  panel.append(renderProgress(resolutionCase));
  const gate = node("div", "gate-card");
  const copy = node("div");
  if (resolutionCase.status === "triaged") copy.append(node("h3", "", "当前闸门：需要人工确认该异常是否进入处置"), node("p", "", "请完成或更新人工复核结论。"));
  else if (resolutionCase.status === "confirmed") copy.append(node("h3", "", "当前闸门：拟定人工处置方案"), node("p", "", "动作类型和说明必须由人工填写。"));
  else if (resolutionCase.status === "proposed" && resolutionCase.runtime.actions.every((action) => action.status === "draft")) copy.append(node("h3", "", "当前闸门：方案已拟定，等待提交审批"), node("p", "", "提交后由独立审批人确认。"));
  else if (resolutionCase.status === "proposed") copy.append(node("h3", "", "当前闸门：等待独立审批人"), node("p", "", "审批人不能是复核人或方案提出人。"));
  else if (resolutionCase.status === "approved") copy.append(node("h3", "", "当前闸门：执行已批准方案"), node("p", "", "执行结果将记录为 local-ledger 演示回执。"));
  else if (resolutionCase.status === "executed") copy.append(node("h3", "", "当前闸门：核验回执并结案"), node("p", "", "所有已批准动作必须有执行结果。"));
  else if (resolutionCase.status === "rejected") copy.append(node("h3", "", "人工复核已终止处置"), node("p", "", "源 Exception 仍存在，不会被删除或改写。"));
  else if (resolutionCase.status === "closed") copy.append(node("h3", "", "处置已结案"), node("p", "", "处置流程已完成；原异常事实与证据仍保留用于审计。"));
  gate.append(copy, node("span", "gate-tag", resolutionCase.status));
  panel.append(gate, snapshotGrid(query));
  if (query.sourceChanged) panel.append(node("div", "inline-notice", "源证据自进入处置后已发生变化。本 Case 仍保留原始 intake lineage 与 Evidence references。"));
  if (resolutionCase.status === "triaged") panel.append(renderReviewForm());
  if (resolutionCase.status === "confirmed") panel.append(renderProposalForm());
  if (resolutionCase.status === "proposed") panel.append(renderProposed(query));
  if (resolutionCase.status === "approved") {
    panel.append(actionList(resolutionCase));
    panel.append(button("执行并记录本地演示回执", "", async () => {
      if (!window.confirm("确认为已批准动作登记 local-ledger 演示执行结果？")) return;
      await mutate(`/api/v2/resolution-cases/${encodeURIComponent(resolutionCase.id)}/execute`, {}, "本地演示能力台账回执已登记。");
    }));
  }
  if (resolutionCase.status === "executed" || resolutionCase.status === "closed") panel.append(renderExecuted(query));
  if (resolutionCase.review) {
    const review = node("section", "explanation-block");
    review.append(node("h4", "", "复核记录"), node("p", "explanation-summary", `${resolutionCase.review.decision} · ${resolutionCase.review.rationale}`));
    panel.append(review);
  }
  panel.append(auditTimeline(resolutionCase.runtime.events));
}

async function loadResolution(exceptionId) {
  const list = await api(`/api/v2/contexts/${encodeURIComponent(contextId)}/resolution-cases`);
  const summary = (list.resolutionCases || []).find((item) => item.exceptionId === exceptionId);
  if (!summary) {
    state.resolution = { summary: null, query: null };
    renderNoResolution();
    return;
  }
  const query = await api(`/api/v2/resolution-cases/${encodeURIComponent(summary.id)}`);
  state.resolution = { summary, query };
  renderResolution(query);
}

async function mutate(path, body, successMessage) {
  if (state.resolutionMutating) return;
  state.resolutionMutating = true;
  const controls = [...document.querySelectorAll("#panel-resolution .button")];
  controls.forEach((control) => { control.disabled = true; });
  showState("正在登记治理操作...");
  try {
    await api(path, { method: "POST", body });
    await refreshAfterMutation();
    showState(successMessage);
  } catch (error) {
    showState(friendlyError(error), true);
  } finally {
    state.resolutionMutating = false;
    controls.forEach((control) => { if (document.contains(control)) control.disabled = false; });
  }
}

async function refreshAfterMutation() {
  const selected = state.selectedExceptionId;
  const view = await api(`/api/v2/contexts/${encodeURIComponent(contextId)}/workbench`);
  state.view = view;
  renderContext(view);
  renderTruthStrip(view);
  renderThread(view);
  state.selectedExceptionId = selected;
  renderExceptions(view);
  renderSelectedException();
  await selectException(selected);
  switchTab("resolution");
}

async function selectException(exceptionId) {
  state.selectedExceptionId = exceptionId;
  state.bundle = null;
  state.explanations = [];
  state.decisionRecommendations = [];
  state.decisionDispositions = [];
  state.selectedDecision = null;
  state.decisionDraft = null;
  state.resolution = null;
  renderSelectedException();
  renderExceptions(state.view);
  clearPanels();
  renderLoadingPanel("panel-evidence");
  renderLoadingPanel("panel-ai");
  renderLoadingPanel("panel-decision");
  renderLoadingPanel("panel-resolution");
  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  const [bundleResult, explanationResult, decisionResult] = await Promise.allSettled([
    api(`${base}/bundle`),
    api(`${base}/explanations`),
    api(`${base}/decision-recommendations`),
  ]);
  if (bundleResult.status === "fulfilled") {
    state.bundle = bundleResult.value;
    renderEvidence(bundleResult.value);
  } else {
    renderEmptyPanel("panel-evidence", bundleResult.reason.status === 404 ? "未找到该异常的证据上下文。" : "证据加载失败。");
  }
  if (explanationResult.status === "fulfilled") renderAIPanel(explanationResult.value.explanations || []);
  else renderEmptyPanel("panel-ai", "解释加载失败，未自动生成新解释。");
  if (decisionResult.status === "fulfilled") {
    const summaries = decisionResult.value.recommendations || [];
    const latest = summaries.at(-1);
    if (!latest) {
      state.decisionRecommendations = [];
      state.selectedDecision = null;
      renderDecisionPanel([]);
    }
    else {
      state.selectedDecision = await api(`${base}/decision-recommendations/${encodeURIComponent(latest.id)}`);
      state.decisionRecommendations = [state.selectedDecision];
      const dispositions = await api(`${base}/decision-recommendations/${encodeURIComponent(latest.id)}/dispositions`).catch(() => ({ dispositions: [] }));
      state.decisionDispositions = dispositions.dispositions || [];
      renderDecisionPanel(state.decisionRecommendations, dispositions.dispositions || []);
    }
  } else renderEmptyPanel("panel-decision", "决策建议加载失败，未自动生成。");
  try {
    await loadResolution(exceptionId);
    if (state.decisionRecommendations.length) renderDecisionPanel(state.decisionRecommendations, state.decisionDispositions);
  } catch (error) {
    renderEmptyPanel("panel-resolution", error.status === 404 ? "该异常尚未进入人工处置。" : "处置状态加载失败。");
  }
}

function switchTab(tab, highlightEvidenceId) {
  state.activeTab = tab;
  for (const element of document.querySelectorAll(".tab")) {
    const active = element.id === `tab-${tab}`;
    element.classList.toggle("active", active);
    element.setAttribute("aria-selected", String(active));
    element.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll(".tab-panel")) panel.classList.toggle("active", panel.id === `panel-${tab}`);
  if (highlightEvidenceId) document.querySelectorAll(".evidence-card").forEach((card) => card.classList.toggle("highlight", card.dataset.evidenceId === highlightEvidenceId));
  if (tab === "evidence") document.getElementById("panel-evidence").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function bindTabs() {
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => switchTab(tab.id.replace("tab-", "")));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  });
}

function bindActorSelector() {
  const control = document.getElementById("demo-actor-control");
  const select = document.getElementById("demo-actor-select");
  if (hasBearerToken()) {
    control.classList.add("hidden");
    return;
  }
  select.value = state.demoActorId;
  select.addEventListener("change", () => {
    state.demoActorId = select.value;
    window.localStorage.setItem("demoActorId", state.demoActorId);
    if (state.resolution?.query) renderResolution(state.resolution.query);
  });
}

async function load() {
  clearState();
  showState("正在读取制造履约上下文...");
  try {
    const view = await api(`/api/v2/contexts/${encodeURIComponent(contextId)}/workbench`);
    state.view = view;
    renderContext(view);
    renderTruthStrip(view);
    renderThread(view);
    state.selectedExceptionId = view.defaultExceptionId;
    renderExceptions(view);
    renderSelectedException();
    clearState();
    if (state.selectedExceptionId) await selectException(state.selectedExceptionId);
    else clearPanels();
  } catch (error) {
    const message = error.status === 404
      ? "制造上下文不存在，或当前租户无权访问。"
      : error.status === 401 || error.status === 403
        ? "当前身份无权访问该制造上下文。"
        : "加载制造履约工作台失败，请稍后重试。";
    showState(message, true);
  }
}

bindTabs();
bindActorSelector();
load();
