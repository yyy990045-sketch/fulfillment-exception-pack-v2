const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export function renderLineChart(container, points, ariaLabel) {
  container.replaceChildren();
  if (points.length < 2) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "当前样本不足以形成趋势。";
    container.append(empty);
    return;
  }
  const width = 620;
  const height = 190;
  const padding = 28;
  const max = Math.max(...points.map((point) => point.value), 1);
  const step = points.length === 1 ? 0 : (width - padding * 2) / (points.length - 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: padding + index * step,
    y: height - padding - (point.value / max) * (height - padding * 2),
  }));
  const svg = svgElement("svg", { class: "line-chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": ariaLabel });
  const title = svgElement("title");
  title.textContent = ariaLabel;
  svg.append(title);
  for (let index = 0; index <= 3; index += 1) {
    const y = padding + ((height - padding * 2) / 3) * index;
    svg.append(svgElement("line", { class: "grid", x1: padding, x2: width - padding, y1: y, y2: y }));
  }
  svg.append(svgElement("polyline", { class: "line", points: coordinates.map((point) => `${point.x},${point.y}`).join(" ") }));
  for (const point of coordinates) {
    svg.append(svgElement("circle", { class: "dot", cx: point.x, cy: point.y, r: 4 }));
    const label = svgElement("text", { x: point.x, y: height - 8, "text-anchor": "middle" });
    label.textContent = point.label;
    svg.append(label);
  }
  container.append(svg);
  container.append(tableFallback(["Bucket", "Exceptions"], points.map((point) => [point.label, point.value])));
}

export function renderHorizontalBars(container, items, options = {}) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无数据。";
    container.append(empty);
    return;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  const list = document.createElement("div");
  list.className = "bar-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", options.ariaLabel || "horizontal bar chart");
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "bar-label";
    label.textContent = item.label;
    label.style.border = "0";
    label.style.background = "transparent";
    label.style.textAlign = "left";
    label.style.cursor = options.onSelect ? "pointer" : "default";
    if (options.onSelect) label.addEventListener("click", () => options.onSelect(item));
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill ${item.tone || ""}`;
    fill.style.width = `${Math.max(2, (item.value / max) * 100)}%`;
    track.append(fill);
    const value = document.createElement("strong");
    value.className = "bar-value";
    value.textContent = item.value;
    row.append(label, track, value);
    list.append(row);
  }
  container.append(list);
  container.append(tableFallback(["Category", "Count"], items.map((item) => [item.label, item.value])));
}

export function renderFunnel(container, items, ariaLabel = "governance funnel") {
  container.replaceChildren();
  const max = Math.max(...items.map((item) => item.value), 1);
  const list = document.createElement("div");
  list.className = "funnel-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", ariaLabel);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = `funnel-row ${item.key || ""}`;
    const label = document.createElement("span");
    label.className = "funnel-label";
    label.textContent = item.label;
    const track = document.createElement("div");
    track.className = "funnel-track";
    const fill = document.createElement("div");
    fill.className = "funnel-fill";
    fill.style.width = `${item.value ? Math.max(3, (item.value / max) * 100) : 0}%`;
    track.append(fill);
    const value = document.createElement("strong");
    value.textContent = item.value;
    row.append(label, track, value);
    list.append(row);
  }
  container.append(list);
  container.append(tableFallback(["Stage", "Count"], items.map((item) => [item.label, item.value])));
}

function tableFallback(headers, rows) {
  const details = document.createElement("details");
  details.className = "table-fallback";
  const summary = document.createElement("summary");
  summary.textContent = "查看数据表";
  details.append(summary);
  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    head.append(cell);
  }
  table.append(head);
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.append(cell);
    }
    table.append(tr);
  }
  details.append(table);
  return details;
}
