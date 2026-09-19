const DEFAULT_CONTEXT_ID = "ctx-so-mfg-001";
const DEFAULT_TENANT_ID = "demo-manufacturing";
const params = new URLSearchParams(window.location.search);
const contextId = params.get("context") || DEFAULT_CONTEXT_ID;

const state = {
  view: null,
  selectedExceptionId: null,
  activeTab: "evidence",
  bundle: null,
  explanations: [],
  selectedExplanation: null,
  resolutionCase: null,
};

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

function requestHeaders() {
  const headers = { accept: "application/json" };
  const token = window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken");
  if (token) {
    headers.authorization = `Bearer ${token}`;
  } else {
    headers["x-tenant-id"] = DEFAULT_TENANT_ID;
  }
  return headers;
}

async function api(path) {
  const response = await fetch(path, { headers: requestHeaders() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
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
    const button = node("button", "exception-item");
    button.type = "button";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-pressed", String(exception.id === state.selectedExceptionId));
    button.append(
      node("strong", "exception-title", exception.label),
      node("span", "exception-code", exception.code),
    );
    const meta = node("div", "exception-meta");
    meta.append(
      node("span", `severity ${exception.severity}`, severityLabels[exception.severity] || exception.severity),
      node("span", "", metricSummary(exception.metrics)),
    );
    button.append(meta);
    button.addEventListener("click", () => selectException(exception.id));
    list.append(button);
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
  for (const id of ["panel-evidence", "panel-ai", "panel-resolution"]) clear(document.getElementById(id));
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
  left.append(
    node("h3", "", "事实与证据"),
    node("p", "", "规则判断只使用下方已登记的 Evidence，不从其他上下文推断。"),
  );
  head.append(left);
  panel.append(head);

  const grid = node("div", "evidence-grid");
  for (const evidence of bundle.evidence) {
    const card = node("article", "evidence-card");
    card.dataset.evidenceId = evidence.evidenceId;
    card.append(node("span", "evidence-role", roleLabels[evidence.role] || evidence.role));
    card.append(node("strong", "evidence-value", typeof evidence.value === "number" ? new Intl.NumberFormat("zh-CN").format(evidence.value) : String(evidence.value)));
    card.append(node("span", "evidence-source", evidenceSourceLabel(bundle, evidence)));
    card.append(node("p", "evidence-quote", evidence.quote || "—"));
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
    const note = node("p", "evidence-quote", "当前可以确认：两份记录存在差异。当前不能确认：客户实际签收数量。");
    panel.append(note);
  }
}

function citationButtons(evidenceIds) {
  const row = node("div");
  for (const evidenceId of evidenceIds || []) {
    const button = node("button", "citation-button", evidenceId);
    button.type = "button";
    button.addEventListener("click", () => switchTab("evidence", evidenceId));
    row.append(button, document.createTextNode(" "));
  }
  return row;
}

function renderExplanation(explanation) {
  const panel = document.getElementById("panel-ai");
  clear(panel);
  const output = explanation.output || {};
  const meta = node("div", "explanation-meta");
  const providerLabel = explanation.provider === "deterministic-demo" ? "演示解释器" : explanation.provider === "openai" ? "OpenAI" : explanation.provider;
  meta.append(
    node("span", "provider-badge", providerLabel),
    node("span", "provider-badge", explanation.model),
    node("span", "provider-badge", explanation.createdAt),
  );
  if (explanation.stale) meta.append(node("span", "provider-badge stale", "基于旧证据快照"));
  panel.append(meta);
  panel.append(node("p", "explanation-summary", output.executiveSummary || ""));
  const facts = node("section", "explanation-block");
  facts.append(node("h4", "", "事实"));
  const factList = node("ul", "explanation-list");
  for (const fact of output.facts || []) {
    const item = node("li");
    item.append(node("span", "", `${fact.statement} `), citationButtons(fact.evidenceIds));
    factList.append(item);
  }
  facts.append(factList);
  panel.append(facts);
  const uncertainties = node("section", "explanation-block");
  uncertainties.append(node("h4", "", "尚不确定"));
  const uncertaintyList = node("ul", "explanation-list");
  for (const item of output.uncertainties || []) {
    const row = node("li");
    row.append(node("span", "", `${item.statement} `), citationButtons(item.evidenceIds));
    uncertaintyList.append(row);
  }
  uncertainties.append(uncertaintyList);
  panel.append(uncertainties);
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
  const selected = explanations[0];
  state.selectedExplanation = selected;
  renderExplanation(selected);
}

function renderResolution(caseQuery) {
  const panel = document.getElementById("panel-resolution");
  clear(panel);
  const resolutionCase = caseQuery.resolutionCase;
  const meta = node("div", "resolution-meta");
  meta.append(
    node("span", "provider-badge", resolutionCase.status),
    node("span", "provider-badge", resolutionCase.ownerRole),
    node("span", "provider-badge", `sourceChanged ${caseQuery.sourceChanged}`),
  );
  panel.append(meta);
  const grid = node("div", "resolution-grid");
  const items = [
    ["Case ID", resolutionCase.id],
    ["Exception", resolutionCase.exceptionId],
    ["Intake Evaluation", caseQuery.intakeEvaluationId],
    ["Current Evaluation", caseQuery.currentEvaluationId],
    ["Created", resolutionCase.createdAt],
    ["Updated", resolutionCase.updatedAt],
  ];
  for (const [label, value] of items) {
    const item = node("div", "resolution-item");
    item.append(node("span", "", label), node("strong", "", value));
    grid.append(item);
  }
  panel.append(grid);
  if (resolutionCase.review) {
    const review = node("section", "explanation-block");
    review.append(node("h4", "", "Review"), node("p", "explanation-summary", `${resolutionCase.review.decision} · ${resolutionCase.review.rationale}`));
    panel.append(review);
  }
  const actions = node("section", "explanation-block");
  actions.append(node("h4", "", "Actions"));
  const actionList = node("ul", "explanation-list");
  for (const action of resolutionCase.runtime?.actions || []) actionList.append(node("li", "", `${action.type} · ${action.summary} · ${action.status}`));
  actions.append(actionList);
  panel.append(actions);
  const receipts = node("section", "explanation-block");
  receipts.append(node("h4", "", "Receipts"));
  const receiptList = node("ul", "explanation-list");
  for (const receipt of caseQuery.receipts || []) receiptList.append(node("li", "", `${receipt.receiptSource} · ${receipt.status} · ${receipt.createdAt}`));
  receipts.append(receiptList);
  panel.append(receipts);
}

async function selectException(exceptionId) {
  state.selectedExceptionId = exceptionId;
  state.bundle = null;
  state.explanations = [];
  state.resolutionCase = null;
  renderSelectedException();
  renderExceptions(state.view);
  clearPanels();
  renderLoadingPanel("panel-evidence");
  renderLoadingPanel("panel-ai");
  renderLoadingPanel("panel-resolution");

  const base = `/api/v2/contexts/${encodeURIComponent(contextId)}/exceptions/${encodeURIComponent(exceptionId)}`;
  try {
    const [bundleResult, explanationResult, resolutionResult] = await Promise.allSettled([
      api(`${base}/bundle`),
      api(`${base}/explanations`),
      api(`/api/v2/contexts/${encodeURIComponent(contextId)}/resolution-cases`),
    ]);
    if (bundleResult.status === "rejected") throw bundleResult.reason;
    state.bundle = bundleResult.value;
    renderEvidence(bundleResult.value);
    if (explanationResult.status === "fulfilled") {
      state.explanations = explanationResult.value.explanations || [];
      renderAIPanel(state.explanations);
    } else {
      renderEmptyPanel("panel-ai", "解释加载失败，未自动生成新解释。");
    }
    if (resolutionResult.status === "fulfilled") {
      const resolutionCase = (resolutionResult.value.resolutionCases || []).find((item) => item.exceptionId === exceptionId);
      if (!resolutionCase) {
        renderEmptyPanel("panel-resolution", "该异常尚未进入人工处置。");
      } else {
        const query = await api(`/api/v2/resolution-cases/${encodeURIComponent(resolutionCase.id)}`);
        state.resolutionCase = query;
        renderResolution(query);
      }
    } else {
      renderEmptyPanel("panel-resolution", "处置状态加载失败。");
    }
  } catch (error) {
    renderEmptyPanel("panel-evidence", error.status === 404 ? "未找到该异常的证据上下文。" : "证据加载失败。");
    renderEmptyPanel("panel-ai", "尚未生成基于当前证据快照的解释。");
    renderEmptyPanel("panel-resolution", "该异常尚未进入人工处置。");
  }
}

function switchTab(tab, highlightEvidenceId) {
  state.activeTab = tab;
  for (const button of document.querySelectorAll(".tab")) {
    const active = button.id === `tab-${tab}`;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === `panel-${tab}`);
  }
  if (highlightEvidenceId) {
    document.querySelectorAll(".evidence-card").forEach((card) => card.classList.toggle("highlight", card.dataset.evidenceId === highlightEvidenceId));
  }
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
load();
