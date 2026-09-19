import { renderFunnel, renderHorizontalBars, renderLineChart } from "./charts.js";

const state = { data: null, exceptionCode: "" };
const demoHeaders = { accept: "application/json", "x-tenant-id": "demo-manufacturing" };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function clear(element) {
  element.replaceChildren();
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

function requestQuery() {
  const params = new URLSearchParams();
  for (const [elementId, parameter] of [
    ["bucket", "bucket"],
    ["from", "from"],
    ["to", "to"],
    ["exceptionCode", "exceptionCode"],
    ["severity", "severity"],
    ["resolutionStatus", "resolutionStatus"],
  ]) {
    const value = document.getElementById(elementId).value;
    if (value) params.set(parameter, value);
  }
  return params;
}

async function api(path) {
  const response = await fetch(path, { headers: demoHeaders });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function formatRate(value) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function renderSummary(data) {
  const strip = document.getElementById("summary-strip");
  clear(strip);
  const items = [
    ["履约上下文", data.summary.contextCount],
    ["已检测异常", data.summary.detectedExceptionCount],
    ["已进入治理", data.summary.exceptionsWithResolutionCase],
    ["已结案", data.summary.closedResolutionCaseCount],
    ["规则评估", data.summary.ruleEvaluationCount],
  ];
  for (const [label, value] of items) {
    const item = node("div", "summary-item");
    item.append(node("span", "", label), node("strong", "", value));
    strip.append(item);
  }
  document.getElementById("window-chip").textContent = `${data.window.bucket} · cohort ${data.window.timeBasis} · trend ${data.window.trendTimeBasis}`;
}

function renderTrend(data) {
  renderLineChart(
    document.getElementById("trend-chart"),
    data.exceptionTrend.map((item) => ({ label: item.bucket, value: item.exceptionCount })),
    "异常出现趋势",
  );
}

function renderBreakdown(data) {
  renderHorizontalBars(
    document.getElementById("exception-bars"),
    data.exceptionBreakdown.map((item) => ({ label: item.label, value: item.count, code: item.code })),
    {
      onSelect(item) {
        state.exceptionCode = item.code;
        document.getElementById("exceptionCode").value = item.code;
        load();
      },
      ariaLabel: "exception type distribution",
    },
  );
}

function renderFunnelChart(data) {
  const labels = {
    no_case: "未进入治理",
    triaged: "待复核",
    confirmed: "已确认",
    proposed_draft: "方案草案",
    pending_approval: "待审批",
    approved: "已批准",
    executed: "已执行",
    closed: "已结案",
    rejected: "已拒绝",
  };
  renderFunnel(
    document.getElementById("funnel-chart"),
    Object.entries(data.resolutionFunnel).map(([key, value]) => ({ key, label: labels[key] || key, value })),
    "governance funnel",
  );
}

function table(container, headers, rows) {
  clear(container);
  const tableElement = node("table");
  const head = node("tr");
  headers.forEach((header) => head.append(node("th", "", header)));
  tableElement.append(head);
  for (const row of rows) {
    const tr = node("tr");
    row.forEach((value) => tr.append(node("td", "", value)));
    tableElement.append(tr);
  }
  container.append(tableElement);
}

function renderRuleTable(data) {
  table(document.getElementById("rule-table"), ["Rule", "Evaluations", "Matched", "Not Matched", "Trigger Rate"], data.rulePerformance.map((item) => [
    item.label,
    item.evaluations,
    item.matched,
    item.notMatched,
    formatRate(item.triggerRate),
  ]));
}

function renderActionTable(data) {
  table(document.getElementById("action-table"), ["Action", "Total", "Draft", "Pending", "Authorized", "Succeeded", "Verified"], data.actionBreakdown.map((item) => [
    item.type,
    item.total,
    item.draft,
    item.pending_approval,
    item.authorized,
    item.succeeded,
    item.verified,
  ]));
}

function renderSourceTable(data) {
  table(document.getElementById("source-table"), ["Source System", "Type", "Involved Exceptions"], data.sourceSystemInvolvement.map((item) => [
    item.name,
    item.systemType,
    item.involvedExceptionCount,
  ]));
}

function renderContexts(data) {
  const container = document.getElementById("context-table");
  clear(container);
  const tableElement = node("table");
  const head = node("tr");
  ["Business Key", "Opened At", "Type", "Exceptions", "Resolution Cases", "Governance States", "Source Systems"].forEach((header) => head.append(node("th", "", header)));
  tableElement.append(head);
  for (const row of data.contexts) {
    const tr = node("tr");
    const business = node("td");
    if (row.contextType === "sales_order") {
      const link = node("a", "context-link", row.businessKey);
      link.href = `/manufacturing?context=${encodeURIComponent(row.contextId)}`;
      business.append(link);
    } else business.textContent = row.businessKey;
    tr.append(business, node("td", "", row.openedAt), node("td", "", row.contextType), node("td", "", row.exceptionCount), node("td", "", row.resolutionCaseCount), node("td", "wrap", row.resolutionStatuses.join("、") || "无"), node("td", "wrap", row.sourceSystemIds.join("、") || "无"));
    tableElement.append(tr);
  }
  container.append(tableElement);
}

function populateExceptionOptions(data) {
  if (state.exceptionCode) return;
  const select = document.getElementById("exceptionCode");
  const current = select.value;
  clear(select);
  const all = node("option", "", "全部");
  all.value = "";
  select.append(all);
  for (const item of data.exceptionBreakdown) {
    const option = node("option", "", item.label);
    option.value = item.code;
    select.append(option);
  }
  select.value = current;
}

async function load() {
  clearState();
  showState("正在读取经营治理分析...");
  try {
    const data = await api(`/api/v2/analytics/operational?${requestQuery().toString()}`);
    state.data = data;
    renderSummary(data);
    populateExceptionOptions(data);
    renderTrend(data);
    renderBreakdown(data);
    renderFunnelChart(data);
    renderRuleTable(data);
    renderActionTable(data);
    renderSourceTable(data);
    renderContexts(data);
    clearState();
  } catch (error) {
    showState(error.status === 400 ? "筛选条件无效。" : "经营治理分析加载失败。", true);
  }
}

document.getElementById("filters-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.exceptionCode = document.getElementById("exceptionCode").value;
  load();
});
load();
