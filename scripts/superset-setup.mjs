/**
 * 用 Superset 官方 REST API 幂等创建 pilot 需要的最小对象：
 *   datasource(analytics 库) → 4 个 dataset → 4 个图表 → 1 个 dashboard → 开启嵌入
 *
 * 账号密码只从 deploy/superset/.env 读取，脚本不会打印任何密钥。
 * 用法：node scripts/superset-setup.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve("deploy/superset/.env");
const DOMAIN = process.env.SUPERSET_DOMAIN ?? "http://127.0.0.1:8088";
const ALLOWED_ORIGINS = (process.env.SUPERSET_EMBED_ALLOWED_ORIGINS
  ?? "http://127.0.0.1:3410,http://127.0.0.1:3411")
  .split(",").map((item) => item.trim()).filter(Boolean);

function loadEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const env = loadEnv(ENV_PATH);
const ADMIN = env.SUPERSET_SERVICE_USERNAME || env.SUPERSET_ADMIN_USERNAME || "admin";
const PASSWORD = env.SUPERSET_SERVICE_PASSWORD || env.SUPERSET_ADMIN_PASSWORD;
if (!PASSWORD) throw new Error("缺少 SUPERSET_SERVICE_PASSWORD / SUPERSET_ADMIN_PASSWORD");

const jar = new Map();
function rememberCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

let accessToken = "";
let csrfToken = "";

async function api(method, path, body) {
  const headers = { accept: "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (jar.size) headers.cookie = cookieHeader();
  if (body !== undefined) headers["content-type"] = "application/json";
  if (csrfToken) headers["x-csrftoken"] = csrfToken;
  const response = await fetch(`${DOMAIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  rememberCookies(response);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 200) }; }
  return { status: response.status, ok: response.ok, payload };
}

async function login() {
  const response = await fetch(`${DOMAIN}/api/v1/security/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username: ADMIN, password: PASSWORD, provider: "db", refresh: false }),
  });
  rememberCookies(response);
  if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
  accessToken = (await response.json()).access_token;
  const csrf = await api("GET", "/api/v1/security/csrf_token/");
  if (!csrf.ok) throw new Error(`csrf failed: HTTP ${csrf.status}`);
  csrfToken = csrf.payload.result;
}

const sum = (column, label) => ({
  expressionType: "SIMPLE",
  column: { column_name: column },
  aggregate: "SUM",
  label,
});

async function ensureDatabase() {
  const list = await api("GET", "/api/v1/database/?q=(page_size:100)");
  const existing = list.payload?.result?.find((item) => item.database_name === "fep analytics");
  if (existing) return existing.id;
  const created = await api("POST", "/api/v1/database/", {
    database_name: "fep analytics",
    sqlalchemy_uri:
      `postgresql+psycopg2://${env.POSTGRES_USER}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@db:5432/analytics`,
    expose_in_sqllab: true,
    allow_ctas: false,
    allow_cvas: false,
    allow_dml: false,
  });
  if (!created.ok) throw new Error(`create database failed: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  return created.payload.id;
}

async function ensureDataset(databaseId, tableName) {
  const list = await api("GET", "/api/v1/dataset/?q=(page_size:100)");
  const existing = list.payload?.result?.find((item) => item.table_name === tableName && item.schema === "analytics");
  if (existing) {
    await api("PUT", `/api/v1/dataset/${existing.id}/refresh`);
    return existing.id;
  }
  const created = await api("POST", "/api/v1/dataset/", {
    database: databaseId,
    schema: "analytics",
    table_name: tableName,
  });
  if (!created.ok) throw new Error(`create dataset ${tableName} failed: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  return created.payload.id;
}

async function ensureChart(datasetId, name, vizType, params) {
  const list = await api("GET", "/api/v1/chart/?q=(page_size:100)");
  const existing = list.payload?.result?.find((item) => item.slice_name === name);
  if (existing) return existing.id;
  const created = await api("POST", "/api/v1/chart/", {
    slice_name: name,
    viz_type: vizType,
    datasource_id: datasetId,
    datasource_type: "table",
    params: JSON.stringify({ viz_type: vizType, ...params }),
  });
  if (!created.ok) throw new Error(`create chart ${name} failed: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  return created.payload.id;
}

function positionJson(charts) {
  const rows = [];
  const layout = {
    DASHBOARD_VERSION_KEY: "v2",
    ROOT_ID: { type: "ROOT", id: "ROOT_ID", children: ["GRID_ID"] },
    GRID_ID: { type: "GRID", id: "GRID_ID", children: [], parents: ["ROOT_ID"] },
    HEADER_ID: { type: "HEADER", id: "HEADER_ID", meta: { text: "履约异常 · 经营分析" } },
  };
  charts.forEach((chart, index) => {
    const rowId = `ROW-${Math.floor(index / 2) + 1}`;
    if (!rows.includes(rowId)) {
      rows.push(rowId);
      layout[rowId] = {
        type: "ROW",
        id: rowId,
        children: [],
        parents: ["ROOT_ID", "GRID_ID"],
        meta: { background: "BACKGROUND_TRANSPARENT" },
      };
      layout.GRID_ID.children.push(rowId);
    }
    const chartId = `CHART-${index + 1}`;
    layout[rowId].children.push(chartId);
    layout[chartId] = {
      type: "CHART",
      id: chartId,
      children: [],
      parents: ["ROOT_ID", "GRID_ID", rowId],
      meta: { chartId: chart.id, width: 6, height: 50, sliceName: chart.name },
    };
  });
  return JSON.stringify(layout);
}

async function ensureDashboard(charts) {
  const list = await api("GET", "/api/v1/dashboard/?q=(page_size:100)");
  const title = "履约异常 · 经营分析";
  const existing = list.payload?.result?.find((item) => item.dashboard_title === title);
  const body = {
    dashboard_title: title,
    published: true,
    position_json: positionJson(charts),
    json_metadata: JSON.stringify({ color_scheme: "supersetColors", refresh_frequency: 0 }),
  };
  if (existing) {
    const updated = await api("PUT", `/api/v1/dashboard/${existing.id}`, body);
    if (!updated.ok) throw new Error(`update dashboard failed: HTTP ${updated.status}`);
    return existing.id;
  }
  const created = await api("POST", "/api/v1/dashboard/", body);
  if (!created.ok) throw new Error(`create dashboard failed: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  return created.payload.id;
}

async function enableEmbedding(dashboardId) {
  // 幂等：先移除旧配置，再按当前白名单重建（uuid 会变化，调用方写回 .env）
  await api("DELETE", `/api/v1/dashboard/${dashboardId}/embedded`);
  const created = await api("POST", `/api/v1/dashboard/${dashboardId}/embedded`, {
    allowed_domains: ALLOWED_ORIGINS,
  });
  if (!created.ok) throw new Error(`enable embedding failed: HTTP ${created.status} ${JSON.stringify(created.payload)}`);
  return created.payload.result.uuid;
}

await login();
const databaseId = await ensureDatabase();
const exceptionDataset = await ensureDataset(databaseId, "fact_exception_type");
const stageDataset = await ensureDataset(databaseId, "fact_resolution_stage");
const ruleDataset = await ensureDataset(databaseId, "fact_rule_performance");
const sourceDataset = await ensureDataset(databaseId, "fact_source_system");

const charts = [];
charts.push({
  name: "异常类型分布",
  id: await ensureChart(exceptionDataset, "异常类型分布", "pie", {
    groupby: ["exception_label"],
    metric: sum("exception_count", "异常数"),
    row_limit: 20,
    donut: true,
    show_legend: true,
  }),
});
charts.push({
  name: "治理推进",
  id: await ensureChart(stageDataset, "治理推进", "bar", {
    groupby: ["stage_label"],
    metric: sum("exception_count", "异常数"),
    order_desc: false,
    row_limit: 20,
    show_legend: true,
  }),
});
charts.push({
  name: "规则触发率",
  id: await ensureChart(ruleDataset, "规则触发率", "table", {
    query_mode: "aggregate",
    groupby: ["rule_label"],
    metrics: [sum("matched", "命中评估"), sum("evaluations", "全部评估"), { expressionType: "SIMPLE", column: { column_name: "trigger_rate" }, aggregate: "AVG", label: "命中率" }],
    row_limit: 50,
  }),
});
charts.push({
  name: "来源系统分布",
  id: await ensureChart(sourceDataset, "来源系统分布", "pie", {
    groupby: ["source_system_name"],
    metric: sum("involved_exception_count", "涉及异常数"),
    row_limit: 20,
    donut: true,
    show_legend: true,
  }),
});

const dashboardId = await ensureDashboard(charts);
const embedUuid = await enableEmbedding(dashboardId);

mkdirSync(".preview/superset", { recursive: true });
writeFileSync(".preview/superset/setup.json", `${JSON.stringify({
  domain: DOMAIN,
  databaseId,
  datasets: { exceptionDataset, stageDataset, ruleDataset, sourceDataset },
  charts,
  dashboardId,
  embedUuid,
  allowedOrigins: ALLOWED_ORIGINS,
}, null, 2)}\n`, "utf8");

// 把 dashboard uuid 写回本地 .env（不打印任何密钥）
const envLines = readFileSync(ENV_PATH, "utf8").split("\n");
const nextEnv = envLines.map((line) =>
  line.startsWith("SUPERSET_DASHBOARD_ID=") ? `SUPERSET_DASHBOARD_ID=${embedUuid}` : line);
writeFileSync(ENV_PATH, nextEnv.join("\n"), "utf8");

console.log(JSON.stringify({
  databaseId,
  datasets: { exceptionDataset, stageDataset, ruleDataset, sourceDataset },
  charts,
  dashboardId,
  embedUuid,
  allowedOrigins: ALLOWED_ORIGINS,
  note: "SUPERSET_DASHBOARD_ID 已写入 deploy/superset/.env（未打印密钥）",
}, null, 2));
