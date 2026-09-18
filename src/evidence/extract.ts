import { createHash } from "node:crypto";
import type { ConflictField, EvidenceItem, GoldCase, GoldMaterial } from "../types.js";

export class EvidenceError extends Error {
  constructor(
    public readonly code: "NO_SCOPE" | "NO_TENANT" | "EMPTY" | "CROSS_TENANT_SOURCE" | "INVALID_CSV",
    message: string,
  ) {
    super(code === "INVALID_CSV" ? `${code}:${message}` : message);
    this.name = "EvidenceError";
  }
}

const MARKDOWN_FIELDS: Record<string, { field: ConflictField | string; compareKey: string; numeric?: boolean }> = {
  型号: { field: "model", compareKey: "model" },
  数量: { field: "qty", compareKey: "qty", numeric: true },
  金额: { field: "amount", compareKey: "totalAmount", numeric: true },
  告警编号: { field: "alertId", compareKey: "alertId" },
  主机: { field: "host", compareKey: "host" },
  级别: { field: "severity", compareKey: "severity" },
  状态: { field: "status", compareKey: "status" },
  说明: { field: "note", compareKey: "note" },
};

const MARKDOWN_FIELD_PATTERN = new RegExp(
  `(?:^|[：:，,。；;\\s])(${Object.keys(MARKDOWN_FIELDS).join("|")})\\s*[:：]?\\s*(.+?)\\s*$`,
);

const HEADER_FIELD: Record<string, { field: ConflictField | string; compareKey: string; numeric?: boolean }> = {
  数量: { field: "qty", compareKey: "qty", numeric: true },
  单价: { field: "amount", compareKey: "unitPrice", numeric: true },
  应收金额: { field: "amount", compareKey: "totalAmount", numeric: true },
  已收金额: { field: "amount", compareKey: "receivedAmount", numeric: true },
  产品型号: { field: "model", compareKey: "model" },
  报价有效期: { field: "date", compareKey: "quoteValidUntil" },
  交货日期: { field: "date", compareKey: "deliveryDate" },
  下单日期: { field: "date", compareKey: "orderDate" },
  到期日: { field: "date", compareKey: "dueDate" },
  收款日期: { field: "date", compareKey: "receivedDate" },
  审批状态: { field: "status", compareKey: "quoteStatus" },
  订单状态: { field: "status", compareKey: "orderStatus" },
  "8D状态": { field: "status", compareKey: "complaintStatus" },
  是否关闭: { field: "status", compareKey: "complaintClosed" },
  负责人: { field: "party", compareKey: "owner" },
  责任部门: { field: "party", compareKey: "department" },
  订单号: { field: "orderId", compareKey: "orderId" },
};

function checksum(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export class CsvParseError extends Error {
  constructor(public readonly line: number, public readonly column: number, message: string) {
    super(`CSV 第${line}行第${column}列：${message}`);
    this.name = "CsvParseError";
  }
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return { headers: [], rows: [] };
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let column = 1;
  let fieldStart = true;
  const pushField = () => { row.push(field); field = ""; fieldStart = true; };
  const pushRow = () => {
    pushField();
    if (row.some((value) => value.length > 0)) records.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; column += 1; }
        else { quoted = false; fieldStart = false; }
      } else {
        field += ch;
        if (ch === "\n") { line += 1; column = 0; }
      }
      column += 1;
      continue;
    }
    if (ch === '"' && fieldStart) { quoted = true; fieldStart = false; column += 1; continue; }
    if (ch === '"') throw new CsvParseError(line, column, "引号只能出现在字段开头或成对转义");
    if (ch === ",") { pushField(); column += 1; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      pushRow(); line += 1; column = 1; continue;
    }
    field += ch; fieldStart = false; column += 1;
  }
  if (quoted) throw new CsvParseError(line, column, "未闭合引号");
  if (field.length > 0 || row.length > 0) pushRow();
  const headers = (records.shift() ?? []).map((header) => header.trim());
  if (!headers.length || headers.some((header) => !header)) throw new CsvParseError(1, 1, "表头不能为空");
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new CsvParseError(1, 1, `表头重复：${header}`);
    seen.add(header);
  }
  for (const [index, record] of records.entries()) {
    if (record.length !== headers.length) throw new CsvParseError(index + 2, 1, `列数为 ${record.length}，应为 ${headers.length}`);
  }
  return { headers, rows: records };
}

function numericValue(raw: string, material: GoldMaterial, row: number, column: number) {
  const normalized = raw.replace(/[，,\s￥¥$]/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new EvidenceError("INVALID_CSV", `${material.fileName} 第${row}行第${column}列不是有效数字`);
  return value;
}

function cellQuote(headers: string[], row: string[], index: number) {
  const h = headers[index] ?? "";
  const v = row[index] ?? "";
  return `${h}=${v}`;
}

function fromCsv(material: GoldMaterial, caseTenant: string): EvidenceItem[] {
  if (!material.csv?.trim()) return [];
  let parsed: { headers: string[]; rows: string[][] };
  try { parsed = parseCsv(material.csv); }
  catch (error) {
    if (error instanceof CsvParseError) throw new EvidenceError("INVALID_CSV", `${material.fileName}：${error.message}`);
    throw error;
  }
  const { headers, rows } = parsed;
  const items: EvidenceItem[] = [];
  rows.forEach((row, rIdx) => {
    headers.forEach((header, cIdx) => {
      const mapped = HEADER_FIELD[header];
      if (!mapped) return;
      const raw = (row[cIdx] ?? "").trim();
      if (!raw) return;
      const value = mapped.numeric ? numericValue(raw, material, rIdx + 2, cIdx + 1) : raw;
      items.push({
        id: `${material.sourceId}-${material.version}-r${rIdx + 2}-c${cIdx + 1}`,
        field: mapped.field,
        compareKey: mapped.compareKey,
        value: Number.isNaN(value as number) ? raw : value,
        claim: `${mapped.field} 为 ${raw}`,
        sourceId: material.sourceId,
        sourceVersion: material.version,
        sourceKind: material.kind,
        locator: {
          fileName: material.fileName,
          sheet: "Sheet1",
          row: rIdx + 2,
          cell: `${String.fromCharCode(65 + cIdx)}${rIdx + 2}`,
        },
        quote: cellQuote(headers, row, cIdx),
        confidence: 1,
        support: "supported",
        tenantId: material.tenantId,
        scope: material.scope,
      });
    });
    const qtyIdx = headers.indexOf("数量");
    const priceIdx = headers.indexOf("单价");
    if (qtyIdx >= 0 && priceIdx >= 0) {
      const qtyRaw = (row[qtyIdx] ?? "").trim();
      const priceRaw = (row[priceIdx] ?? "").trim();
      if (qtyRaw && priceRaw) {
        const qty = numericValue(qtyRaw, material, rIdx + 2, qtyIdx + 1);
        const price = numericValue(priceRaw, material, rIdx + 2, priceIdx + 1);
        items.push({
          id: `${material.sourceId}-${material.version}-total-${rIdx + 2}`,
          field: "amount",
          compareKey: "totalAmount",
          value: qty * price,
          claim: `总额 ${qty * price}`,
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, sheet: "Sheet1", row: rIdx + 2, cell: `${String.fromCharCode(65 + qtyIdx)}${rIdx + 2}` },
          quote: `数量=${qtyRaw} 单价=${priceRaw}`,
          confidence: 1,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
    }
    const receivedIdx = headers.indexOf("已收金额");
    if (receivedIdx >= 0) {
      const receivedRaw = (row[receivedIdx] ?? "0").trim();
      const received = receivedRaw ? numericValue(receivedRaw, material, rIdx + 2, receivedIdx + 1) : 0;
      items.push({
        id: `${material.sourceId}-${material.version}-settle-${rIdx + 2}`,
        field: "status",
        compareKey: "settlementStatus",
        value: received > 0 ? "已收款" : "未收",
        claim: received > 0 ? "已收款" : "未收",
        sourceId: material.sourceId,
        sourceVersion: material.version,
        sourceKind: material.kind,
        locator: { fileName: material.fileName, row: rIdx + 2 },
        quote: cellQuote(headers, row, receivedIdx),
        confidence: 1,
        support: "supported",
        tenantId: material.tenantId,
        scope: material.scope,
      });
    }
    const closedIdx = headers.indexOf("是否关闭");
    const eightIdx = headers.indexOf("8D状态");
    if (closedIdx >= 0 || eightIdx >= 0) {
      const closed = (row[closedIdx] ?? "") === "是" || (row[eightIdx] ?? "") === "已关闭";
      if (closed) {
        items.push({
          id: `${material.sourceId}-${material.version}-closed-${rIdx + 2}`,
          field: "status",
          compareKey: "settlementStatus",
          value: "已关闭",
          claim: "客诉已关闭",
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, row: rIdx + 2 },
          quote: cellQuote(headers, row, eightIdx >= 0 ? eightIdx : closedIdx),
          confidence: 1,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
    }
    const descIdx = headers.indexOf("问题描述");
    if (descIdx >= 0) {
      const desc = row[descIdx] ?? "";
      const claimMatch = desc.match(/索赔(\d+)/);
      if (claimMatch?.[1]) {
        items.push({
          id: `${material.sourceId}-${material.version}-claim-${rIdx + 2}`,
          field: "amount",
          compareKey: "totalAmount",
          value: Number(claimMatch[1]),
          claim: `客诉索赔 ${claimMatch[1]}`,
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, row: rIdx + 2, cell: `${String.fromCharCode(65 + descIdx)}${rIdx + 2}` },
          quote: desc,
          confidence: 0.9,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
      const qtyMatch = desc.match(/(\d+)件/);
      if (qtyMatch?.[1]) {
        items.push({
          id: `${material.sourceId}-${material.version}-qtydesc-${rIdx + 2}`,
          field: "qty",
          compareKey: "qty",
          value: Number(qtyMatch[1]),
          claim: `客诉数量 ${qtyMatch[1]}`,
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, row: rIdx + 2 },
          quote: desc,
          confidence: 0.85,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
      if (/从未付款|未付款/.test(desc)) {
        items.push({
          id: `${material.sourceId}-${material.version}-unpaid-${rIdx + 2}`,
          field: "amount",
          compareKey: "receivedAmount",
          value: 0,
          claim: "客诉称未付款",
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, row: rIdx + 2 },
          quote: desc,
          confidence: 0.8,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
      if (/包赔|终身免费|绝对/.test(desc)) {
        items.push({
          id: `${material.sourceId}-${material.version}-promise-${rIdx + 2}`,
          field: "status",
          compareKey: "promise",
          value: "越权承诺",
          claim: "描述含越权承诺词",
          sourceId: material.sourceId,
          sourceVersion: material.version,
          sourceKind: material.kind,
          locator: { fileName: material.fileName, row: rIdx + 2 },
          quote: desc,
          confidence: 1,
          support: "supported",
          tenantId: material.tenantId,
          scope: material.scope,
        });
      }
    }
  });
  void caseTenant;
  return items;
}

function fromMarkdown(material: GoldMaterial): EvidenceItem[] {
  const text = material.markdown ?? "";
  if (!text.trim()) return [];
  const items: EvidenceItem[] = [];
  const lines = text.split("\n");
  let standingContext = "";
  lines.forEach((line, i) => {
    if (!line.trim()) {
      standingContext = "";
      return;
    }
    const m = line.match(MARKDOWN_FIELD_PATTERN);
    if (!m) return;
    const label = m[1] ?? "";
    const raw = (m[2] ?? "").trim();
    const mapped = MARKDOWN_FIELDS[label];
    if (!mapped) return;
    const linePrefix = line.slice(0, m.index ?? 0);
    if (/样品/.test(linePrefix)) standingContext = "样品";
    const sampleQuantity = label === "数量" && /样品/.test(`${standingContext}${linePrefix}`);
    const compareKey = sampleQuantity ? "sampleQty" : mapped.compareKey;
    const numeric = Boolean(mapped.numeric);
    const normalizedNumber = Number(raw.replace(/[，,\s￥¥$]/g, ""));
    items.push({
      id: `${material.sourceId}-${material.version}-l${i + 1}`,
      field: mapped.field,
      compareKey,
      value: numeric && Number.isFinite(normalizedNumber) ? normalizedNumber : raw,
      claim: `${sampleQuantity ? "样品数量" : label} 为 ${raw}`,
      sourceId: material.sourceId,
      sourceVersion: material.version,
      sourceKind: material.kind,
      locator: { fileName: material.fileName, line: i + 1 },
      quote: line.trim(),
      confidence: 1,
      support: "supported",
      tenantId: material.tenantId,
      scope: material.scope,
    });
  });
  return items;
}

export function extractMaterial(material: GoldMaterial, tenantId: string, scope: string): EvidenceItem[] {
  if (!tenantId) throw new EvidenceError("NO_TENANT", "缺少租户，fail-closed");
  if (!scope) throw new EvidenceError("NO_SCOPE", "缺少 scope，fail-closed");
  if (material.tenantId !== tenantId) throw new EvidenceError("CROSS_TENANT_SOURCE", `CROSS_TENANT_SOURCE:${material.sourceId}`);
  if (material.scope !== scope) return [];
  const body = `${material.csv ?? ""}${material.markdown ?? ""}`;
  if (!body.trim()) throw new EvidenceError("EMPTY", `${material.fileName} 无内容`);
  const items = [...fromCsv(material, tenantId), ...fromMarkdown(material)];
  return items.filter((item) => item.locator.fileName && (item.locator.row || item.locator.line || item.locator.page));
}

export function extractCase(gold: GoldCase, opts?: { tenantId?: string; scope?: string }): EvidenceItem[] {
  const tenantId = opts?.tenantId ?? gold.tenantId;
  const scope = opts?.scope ?? gold.scope;
  if (!tenantId) throw new EvidenceError("NO_TENANT", "缺少租户，fail-closed");
  if (!scope) throw new EvidenceError("NO_SCOPE", "缺少 scope，fail-closed");
  if (gold.tenantId !== tenantId) throw new EvidenceError("CROSS_TENANT_SOURCE", `CROSS_TENANT_SOURCE:${gold.id}`);
  const items: EvidenceItem[] = [];
  for (const material of gold.materials) {
    items.push(...extractMaterial(material, tenantId, scope));
  }
  void checksum(gold.id);
  return items;
}

export function unsupportedWithoutLocator(claim: string, tenantId: string, scope: string): EvidenceItem {
  return {
    id: "orphan-claim",
    field: "amount",
    compareKey: "totalAmount",
    value: 999999,
    claim,
    sourceId: "model",
    sourceVersion: "none",
    locator: { fileName: "" },
    quote: "",
    confidence: 0,
    support: "unsupported",
    tenantId,
    scope,
  };
}
