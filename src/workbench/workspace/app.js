const params = new URLSearchParams(window.location.search);
const contextId = params.get("context");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function showState(message, error = false) {
  const banner = document.getElementById("state-banner");
  banner.textContent = message;
  banner.classList.add("visible");
  banner.classList.toggle("error", error);
}

function headers() {
  const token = window.localStorage.getItem("authToken") || window.sessionStorage.getItem("authToken");
  return token ? { accept: "application/json", authorization: `Bearer ${token}` } : { accept: "application/json", "x-tenant-id": "demo-manufacturing", "x-actor": "quality-owner" };
}

async function load() {
  if (!contextId) {
    showState("缺少 context 参数。", true);
    return;
  }
  try {
    const response = await fetch(`/api/v2/contexts/${encodeURIComponent(contextId)}/pack-workbench`, { headers: headers() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `http_${response.status}`);
    document.getElementById("context-title").textContent = `${data.context.businessKey} · ${data.pack.name}`;
    document.getElementById("context-meta").textContent = `${data.pack.contextLabel} · ${data.stats.entities} entities · ${data.stats.evidence} evidence · ${data.stats.exceptions} exceptions`;
    document.getElementById("thread-title").textContent = `${data.pack.contextLabel} Business Thread`;
    const thread = document.getElementById("thread");
    thread.replaceChildren();
    for (const stage of data.thread) {
      const card = el("article", "stage");
      card.dataset.state = stage.state;
      card.append(el("strong", "", stage.label), el("div", "muted", stage.businessKey));
      const facts = el("div", "facts");
      for (const fact of stage.facts) facts.append(el("span", "fact", `${fact.label}：${fact.value}`));
      card.append(facts);
      thread.append(card);
    }
    for (const [id, items, render] of [
      ["rules", data.rules, (item) => `${item.label} · ${item.status}`],
      ["exceptions", data.exceptions, (item) => `${item.label} · ${item.severity}`],
      ["outcomes", data.outcomes, (item) => `${item.status} · ${item.definitionId}`],
    ]) {
      const host = document.getElementById(id);
      host.replaceChildren();
      for (const item of items) host.append(el("div", "row", render(item)));
    }
  } catch (error) {
    showState(error.message, true);
  }
}

load();
