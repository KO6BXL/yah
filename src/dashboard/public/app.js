const tabs = [
  ["config", "Config"],
  ["tree", "Context Tree"],
  ["memory", "Memory"],
  ["approvals", "Pending"],
  ["archive", "Archive"],
  ["sources", "Sources"],
  ["janitor", "Janitor"]
];

const state = {
  snapshot: null,
  active: "config",
  memorySearch: {
    q: "",
    scope: "",
    kind: "",
    status: ""
  },
  memoryResults: null
};

const text = (value) => value === undefined || value === null || value === "" ? "none" : String(value);
const esc = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

function pill(label, className = "") {
  return `<span class="pill ${esc(className)}">${esc(label)}</span>`;
}

function card(title, body, tags = []) {
  return [
    '<article class="card">',
    '<div class="card-head">',
    `<span class="card-title">${esc(title)}</span>`,
    `<span class="pills">${tags.map((tag) => pill(tag.label, tag.className)).join("")}</span>`,
    '</div>',
    `<div class="card-body">${body}</div>`,
    '</article>'
  ].join("");
}

function kv(rows) {
  return `<dl class="kv">${rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

function renderNav() {
  qs("#tabs").innerHTML = tabs
    .map(([id, label]) => `<button class="tab ${state.active === id ? "active" : ""}" data-tab="${id}">${esc(label)}</button>`)
    .join("");
  qsa("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    state.active = button.dataset.tab;
    render();
  }));
}

function render() {
  renderNav();
  const snapshot = state.snapshot;
  if (!snapshot) {
    qs("#content").innerHTML = '<div class="empty">Loading dashboard.</div>';
    return;
  }

  qs("#meta").innerHTML = [
    pill(snapshot.config.agentProvider),
    pill(snapshot.config.model),
    pill(snapshot.generatedAt)
  ].join("");

  const sections = {
    config: renderConfig(snapshot),
    tree: renderTree(snapshot),
    memory: renderMemory(snapshot),
    approvals: renderRecords("Pending Approvals", snapshot.memory.pendingApprovals),
    archive: renderRecords("Archived Memory", snapshot.memory.archived),
    sources: renderSources(snapshot),
    janitor: renderRecords("Janitor Digests", snapshot.memory.janitorDigests)
  };
  qs("#content").innerHTML = sections[state.active];
  bindMemoryToolbar();
}

function renderConfig(snapshot) {
  const cfg = snapshot.config;
  return `<div class="section">
    <h2>Config</h2>
    <div class="grid">
      ${card("Providers", kv([
        ["Prompt", `<code>${esc(cfg.promptProvider)}</code>`],
        ["Agent", `<code>${esc(cfg.agentProvider)}</code>`],
        ["Model", `<code>${esc(cfg.model)}</code>`]
      ]))}
      ${card("Discord", kv([
        ["Task Channel", `<code>${esc(cfg.channelId)}</code>`],
        ["Task Input", `<code>${esc(snapshot.restrictions.discordIsTaskInput)}</code>`]
      ]))}
      ${card("Boundaries", kv([
        ["Channels", `<code>${esc(snapshot.restrictions.channelBoundaries)}</code>`],
        ["Approvals", `<code>${esc(snapshot.restrictions.approvalBoundary)}</code>`]
      ]))}
      ${card("Dashboard", kv([
        ["Host", `<code>${esc(cfg.dashboard.host)}</code>`],
        ["Port", `<code>${esc(cfg.dashboard.port)}</code>`],
        ["Janitor", `<code>${esc(cfg.janitorIntervalMs)}</code>`]
      ]))}
    </div>
  </div>`;
}

function renderTree(snapshot) {
  const rows = snapshot.restrictions.nodePermissions.map((node) => [
    `<tr><td>${esc(node.kind)}</td>`,
    `<td>${esc(node.name)}</td>`,
    `<td><code>${esc(node.id)}</code></td>`,
    `<td>${esc(node.approvalPolicy)}</td>`,
    `<td>${esc(node.ownerUserIds.join(", ") || "none")}</td>`,
    `<td>${esc(node.approvedRoleIds.join(", ") || "none")}</td></tr>`
  ].join("")).join("");
  return `<div class="section">
    <h2>Context Tree</h2>
    <table class="table">
      <thead><tr><th>Kind</th><th>Name</th><th>ID</th><th>Approval</th><th>Owners</th><th>Roles</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='6'>No context nodes registered.</td></tr>"}</tbody>
    </table>
  </div>`;
}

function renderMemory(snapshot) {
  const records = state.memoryResults ?? snapshot.memory.category.concat(snapshot.memory.channel);
  return `<div class="section">
    <h2>Memory</h2>
    <div class="toolbar" id="memory-toolbar">
      <label>Search<input name="q" value="${esc(state.memorySearch.q)}" autocomplete="off"></label>
      <label>Scope${select("scope", ["", "category", "channel", "thread"], state.memorySearch.scope)}</label>
      <label>Kind${select("kind", ["", "task", "working", "semantic", "episodic", "procedural", "artifact"], state.memorySearch.kind)}</label>
      <label>Status${select("status", ["", "active", "proposed", "superseded", "archived", "deleted"], state.memorySearch.status)}</label>
    </div>
    <div class="grid">${records.length ? records.map(recordCard).join("") : '<div class="empty">No records.</div>'}</div>
  </div>`;
}

function select(name, options, selected) {
  return `<select name="${esc(name)}">${options.map((option) => {
    const label = option || "any";
    return `<option value="${esc(option)}" ${option === selected ? "selected" : ""}>${esc(label)}</option>`;
  }).join("")}</select>`;
}

function bindMemoryToolbar() {
  const toolbar = qs("#memory-toolbar");
  if (!toolbar) return;
  const run = debounce(async () => {
    const form = new FormData();
    qsa("#memory-toolbar input, #memory-toolbar select").forEach((field) => {
      form.set(field.name, field.value);
      state.memorySearch[field.name] = field.value;
    });
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (value) params.set(key, value);
    }
    const response = await fetch(`/api/memory?${params.toString()}`);
    if (!response.ok) {
      throw new Error((await response.json()).error || response.statusText);
    }
    state.memoryResults = await response.json();
    render();
  }, 180);
  qsa("#memory-toolbar input, #memory-toolbar select").forEach((field) => {
    field.addEventListener("input", run);
    field.addEventListener("change", run);
  });
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args).catch(showError), wait);
  };
}

function renderRecords(title, records) {
  return `<div class="section">
    <h2>${esc(title)}</h2>
    <div class="grid">${records.length ? records.map(recordCard).join("") : '<div class="empty">No records.</div>'}</div>
  </div>`;
}

function recordCard(record) {
  const statusClass = record.status === "proposed" ? "pending" : record.status;
  const sourceClass = record.source.createdBy === "agent" || record.source.createdBy === "janitor" ? "agent" : "";
  return card(`${record.kind} / ${record.scope}`, [
    '<div class="record">',
    `<pre>${esc(record.content)}</pre>`,
    `<div class="pills">${[
      pill(record.id),
      pill(record.nodeId),
      pill(record.status, statusClass),
      pill(record.freshness, record.freshness),
      pill(record.source.createdBy, sourceClass)
    ].join("")}</div>`,
    kv([
      ["Source", `<code>${esc(record.sourceSummary)}</code>`],
      ["Approval", `<code>${esc(record.approvalSummary)}</code>`],
      ["Visibility", `<code>${esc(record.visibility)}</code>`],
      ["Updated", `<code>${esc(record.updatedAt)}</code>`],
      ["Tags", `<code>${esc(record.tags.join(", ") || "none")}</code>`]
    ]),
    '</div>'
  ].join(""), [{label: record.status, className: statusClass}]);
}

function renderSources(snapshot) {
  const auditRows = snapshot.sourceHistory.auditEvents.slice(0, 80).map((event) => [
    `<tr><td>${esc(event.createdAt)}</td>`,
    `<td>${esc(event.action)}</td>`,
    `<td><code>${esc(event.memoryId)}</code></td>`,
    `<td>${esc(event.actor)}</td>`,
    `<td>${esc(event.note)}</td></tr>`
  ].join("")).join("");
  const logRows = snapshot.sourceHistory.threadLogs.slice(0, 80).map((entry) => [
    `<tr><td>${esc(entry.createdAt)}</td>`,
    `<td>${esc(entry.role)}</td>`,
    `<td><code>${esc(entry.threadId)}</code></td>`,
    `<td>${esc(entry.discordMessageId)}</td>`,
    `<td>${esc(entry.content)}</td></tr>`
  ].join("")).join("");
  return `<div class="section">
    <h2>Source History</h2>
    <table class="table">
      <thead><tr><th>Time</th><th>Action</th><th>Memory</th><th>Actor</th><th>Note</th></tr></thead>
      <tbody>${auditRows || "<tr><td colspan='5'>No audit events.</td></tr>"}</tbody>
    </table>
    <table class="table">
      <thead><tr><th>Time</th><th>Role</th><th>Thread</th><th>Message</th><th>Content</th></tr></thead>
      <tbody>${logRows || "<tr><td colspan='5'>No thread logs.</td></tr>"}</tbody>
    </table>
  </div>`;
}

function showError(error) {
  qs("#content").innerHTML = `<div class="error"><strong>Error</strong><pre>${esc(error.message)}</pre></div>`;
}

fetch("/api/dashboard")
  .then((response) => {
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  })
  .then((snapshot) => {
    state.snapshot = snapshot;
    render();
  })
  .catch(showError);
