import { type Config } from "../store/config.ts";
import { ContextStore } from "../store/contextStore.ts";
import { MemoryStore, type MemoryAuditEvent } from "../store/memoryStore.ts";
import { ThreadLogStore, type ThreadLogEntry } from "../store/threadLogStore.ts";
import { type MemoryRecord } from "../domain/context.ts";

type DashboardConfig = Config["dashboard"]

export type DashboardMemoryView = MemoryRecord & {
    freshness: "current" | "stale" | "expired"
    sourceSummary: string
    approvalSummary: string
}

export type DashboardSnapshot = {
    generatedAt: string
    config: {
        promptProvider: Config["promptProvider"]
        agentProvider: Config["agentProvider"]
        model: string
        channelId: string
        janitorIntervalMs?: number
        dashboard: DashboardConfig
    }
    context: {
        categories: Awaited<ReturnType<typeof ContextStore.listCategories>>
        channels: Awaited<ReturnType<typeof ContextStore.listChannels>>
        threads: Awaited<ReturnType<typeof ContextStore.listThreads>>
    }
    restrictions: {
        discordIsTaskInput: true
        promptProvider: Config["promptProvider"]
        channelBoundaries: string
        approvalBoundary: string
        nodePermissions: Array<{
            kind: "category" | "channel" | "thread"
            id: string
            name: string
            approvalPolicy: string
            ownerUserIds: string[]
            approvedRoleIds: string[]
        }>
    }
    memory: {
        category: DashboardMemoryView[]
        channel: DashboardMemoryView[]
        pendingApprovals: DashboardMemoryView[]
        archived: DashboardMemoryView[]
        janitorDigests: DashboardMemoryView[]
        all: DashboardMemoryView[]
    }
    sourceHistory: {
        auditEvents: MemoryAuditEvent[]
        threadLogs: ThreadLogEntry[]
    }
}

export class Dashboard {
    private server?: Bun.Server<object>

    constructor(private readonly config: Config) {}

    public start() {
        if (!this.config.dashboard.enabled || this.server) {
            return
        }

        this.server = Bun.serve({
            hostname: this.config.dashboard.host,
            port: this.config.dashboard.port,
            fetch: (request) => this.handle(request),
        })
        console.log(`YAH dashboard listening on http://${this.server.hostname}:${this.server.port}`)
    }

    public dispose() {
        this.server?.stop()
        this.server = undefined
    }

    public async handle(request: Request) {
        const url = new URL(request.url)
        if (url.pathname === "/") {
            return new Response(dashboardHtml(), {
                headers: {"content-type": "text/html; charset=utf-8"},
            })
        }
        if (url.pathname === "/api/dashboard") {
            return Response.json(await Dashboard.snapshot(this.config))
        }
        if (url.pathname === "/api/config") {
            return Response.json(Dashboard.publicConfig(this.config))
        }
        return new Response("Not found", {status: 404})
    }

    public static async snapshot(config: Config): Promise<DashboardSnapshot> {
        const [categories, channels, threads, memory, auditEvents, threadLogs] = await Promise.all([
            ContextStore.listCategories(),
            ContextStore.listChannels(),
            ContextStore.listThreads(),
            MemoryStore.list(),
            MemoryStore.listAuditEvents(),
            Dashboard.listThreadLogs(),
        ])
        const views = memory
            .map((record) => Dashboard.memoryView(record))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        const nodePermissions = [...categories, ...channels, ...threads].map((node) => ({
            kind: node.kind,
            id: node.id,
            name: node.name,
            approvalPolicy: node.permissions.approvalPolicy,
            ownerUserIds: node.permissions.ownerUserIds,
            approvedRoleIds: node.permissions.approvedRoleIds,
        }))

        return {
            generatedAt: new Date().toISOString(),
            config: Dashboard.publicConfig(config),
            context: {categories, channels, threads},
            restrictions: {
                discordIsTaskInput: true,
                promptProvider: config.promptProvider,
                channelBoundaries: "Channels share context only through approved category memory or explicit filesystem artifacts.",
                approvalBoundary: "Category, task, and procedural memory changes require proposal review before activation.",
                nodePermissions,
            },
            memory: {
                category: views.filter((record) => record.scope === "category" && record.status !== "archived"),
                channel: views.filter((record) => record.scope === "channel" && record.status !== "archived"),
                pendingApprovals: views.filter((record) => record.status === "proposed"),
                archived: views.filter((record) => record.status === "archived"),
                janitorDigests: views.filter((record) => record.tags.includes("janitor-digest")),
                all: views,
            },
            sourceHistory: {
                auditEvents: auditEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
                threadLogs: threadLogs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            },
        }
    }

    private static publicConfig(config: Config) {
        return {
            promptProvider: config.promptProvider,
            agentProvider: config.agentProvider,
            model: config.model,
            channelId: config.channelId,
            janitorIntervalMs: config.janitorIntervalMs,
            dashboard: config.dashboard,
        }
    }

    private static memoryView(record: MemoryRecord): DashboardMemoryView {
        return {
            ...record,
            freshness: Dashboard.freshness(record),
            sourceSummary: Dashboard.sourceSummary(record),
            approvalSummary: Dashboard.approvalSummary(record),
        }
    }

    private static freshness(record: MemoryRecord): DashboardMemoryView["freshness"] {
        if (record.validUntil && Date.parse(record.validUntil) <= Date.now()) {
            return "expired"
        }
        if (record.tags.includes("stale")) {
            return "stale"
        }
        return "current"
    }

    private static sourceSummary(record: MemoryRecord) {
        const parts = [
            record.source.createdBy,
            record.source.discordGuildId ? `guild:${record.source.discordGuildId}` : undefined,
            record.source.discordChannelId ? `channel:${record.source.discordChannelId}` : undefined,
            record.source.discordThreadId ? `thread:${record.source.discordThreadId}` : undefined,
            record.source.discordMessageId ? `message:${record.source.discordMessageId}` : undefined,
            record.source.toolName ? `tool:${record.source.toolName}` : undefined,
        ].filter(Boolean)
        return parts.join(" / ")
    }

    private static approvalSummary(record: MemoryRecord) {
        if (record.userApproved) {
            return record.approvedByUserId
                ? `approved by ${record.approvedByUserId}${record.approvedAt ? ` at ${record.approvedAt}` : ""}`
                : "approved"
        }
        if (record.status === "proposed") {
            return "pending approval"
        }
        return "not approved"
    }

    private static async listThreadLogs() {
        const ids = await ThreadLogStore.listThreadIds()
        const logs = await Promise.all(ids.map((id) => ThreadLogStore.list(id)))
        return logs.flat()
    }
}

function dashboardHtml() {
    return `<!doctype html>
<html lang="en">
	<head>
	  <meta charset="utf-8">
	  <meta name="viewport" content="width=device-width, initial-scale=1">
	  <title>YAH Dashboard</title>
	  <style>
	    :root {
	      color-scheme: dark;
	      --ink: #ece7dc;
	      --muted: #a59d8f;
	      --line: #37342f;
	      --paper: #11100e;
	      --panel: #191715;
	      --panel-strong: #211f1b;
	      --nav: #151412;
	      --accent: #58c7b5;
	      --warn: #e0a84f;
	      --bad: #e06b62;
	      --ok: #8bcf75;
	      --shadow: rgba(0, 0, 0, 0.34);
	    }
	    * { box-sizing: border-box; }
	    body {
	      margin: 0;
	      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
	      background:
	        radial-gradient(circle at top left, rgba(88, 199, 181, 0.08), transparent 28rem),
	        linear-gradient(180deg, #151311 0%, var(--paper) 24rem);
	      color: var(--ink);
	    }
	    header {
	      display: grid;
	      grid-template-columns: 1fr auto;
      gap: 24px;
	      align-items: end;
	      padding: 28px 32px 18px;
	      border-bottom: 1px solid var(--line);
	      background: rgba(25, 23, 21, 0.92);
	      box-shadow: 0 12px 30px var(--shadow);
	    }
	    h1 { margin: 0; font-size: 32px; letter-spacing: 0; }
	    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    main {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      min-height: calc(100vh - 92px);
    }
	    nav {
	      padding: 18px;
	      border-right: 1px solid var(--line);
	      background: var(--nav);
	    }
	    button {
	      width: 100%;
	      border: 1px solid transparent;
      background: transparent;
      padding: 10px 12px;
      text-align: left;
      font: inherit;
	      color: var(--ink);
	      cursor: pointer;
	    }
	    button:hover {
	      border-color: #4c473f;
	      background: #1d1b18;
	    }
	    button:focus-visible {
	      outline: 2px solid var(--accent);
	      outline-offset: 2px;
	    }
	    button.active {
	      border-color: var(--accent);
	      background: var(--panel-strong);
	      color: #f7f0e3;
	    }
	    section { padding: 24px 28px 40px; }
    .meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: end;
      color: var(--muted);
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
	    .card {
	      border: 1px solid var(--line);
	      border-radius: 6px;
	      background: var(--panel);
	      padding: 14px;
	      min-width: 0;
	      box-shadow: 0 8px 24px var(--shadow);
	    }
    .title {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
      font-weight: 700;
    }
	    .pill {
	      display: inline-block;
	      border: 1px solid var(--line);
	      border-radius: 999px;
	      padding: 2px 8px;
	      color: var(--muted);
	      background: #12110f;
	      font-size: 12px;
	      white-space: nowrap;
	    }
	    .pending { color: var(--warn); border-color: #8d672a; background: #21190e; }
	    .archived { color: var(--bad); border-color: #7d3934; background: #241211; }
	    .current { color: var(--ok); border-color: #4d7a40; background: #142011; }
	    pre, code {
	      font-family: "Berkeley Mono", "SFMono-Regular", Consolas, monospace;
	      font-size: 12px;
	      color: #d8d2c8;
	    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
	    .table {
	      width: 100%;
	      border-collapse: collapse;
	      background: var(--panel);
	      border: 1px solid var(--line);
	      box-shadow: 0 8px 24px var(--shadow);
	    }
    .table th, .table td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .table th {
      color: var(--muted);
      font-weight: 400;
    }
    .stack { display: grid; gap: 14px; }
    @media (max-width: 760px) {
      header { grid-template-columns: 1fr; }
      main { grid-template-columns: 1fr; }
      nav {
        display: flex;
        overflow-x: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      nav button {
        width: auto;
        min-width: max-content;
      }
      .meta { justify-content: start; }
    }
  </style>
</head>
<body>
  <header>
    <h1>YAH Dashboard</h1>
    <div class="meta" id="meta"></div>
  </header>
  <main>
    <nav id="tabs"></nav>
    <div id="content"></div>
  </main>
  <script>
    const tabs = [
      ["config", "Config"],
      ["tree", "Context Tree"],
      ["memory", "Memory"],
      ["approvals", "Pending"],
      ["archive", "Archive"],
      ["sources", "Sources"],
      ["janitor", "Janitor"]
    ];
    const state = {snapshot: null, active: "config"};
    const text = (value) => value === undefined || value === null || value === "" ? "none" : String(value);
    const esc = (value) => text(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[char]));
    const card = (title, body, tags = []) => '<article class="card"><div class="title"><span>' + esc(title) + '</span><span>' + tags.map((tag) => '<span class="pill ' + esc(tag.className || "") + '">' + esc(tag.label) + '</span>').join(" ") + '</span></div>' + body + '</article>';
    const recordCard = (record) => card(record.kind + " / " + record.scope, [
      '<pre>' + esc(record.content) + '</pre>',
      '<p><span class="pill">' + esc(record.id) + '</span> <span class="pill">' + esc(record.nodeId) + '</span> <span class="pill ' + record.freshness + '">' + esc(record.freshness) + '</span></p>',
      '<p><strong>Source</strong><br><code>' + esc(record.sourceSummary) + '</code></p>',
      '<p><strong>Approval</strong><br><code>' + esc(record.approvalSummary) + '</code></p>',
      '<p><strong>Scope</strong><br><code>' + esc(record.scope + " / " + record.visibility) + '</code></p>',
      '<p><strong>Updated</strong><br><code>' + esc(record.updatedAt) + '</code></p>',
      '<p><strong>Tags</strong><br><code>' + esc(record.tags.join(", ") || "none") + '</code></p>'
    ].join(""), [{label: record.status, className: record.status === "proposed" ? "pending" : record.status === "archived" ? "archived" : ""}]);
    function renderNav() {
      document.getElementById("tabs").innerHTML = tabs.map(([id, label]) => '<button data-tab="' + id + '" class="' + (state.active === id ? "active" : "") + '">' + label + '</button>').join("");
      document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
        state.active = button.dataset.tab;
        render();
      }));
    }
    function render() {
      const snapshot = state.snapshot;
      renderNav();
      if (!snapshot) return;
      document.getElementById("meta").innerHTML = [
        '<span>' + esc(snapshot.config.agentProvider) + '</span>',
        '<span>' + esc(snapshot.config.model) + '</span>',
        '<span>' + esc(snapshot.generatedAt) + '</span>'
      ].join("");
      const sections = {
        config: renderConfig(snapshot),
        tree: renderTree(snapshot),
        memory: renderRecords("Memory", snapshot.memory.category.concat(snapshot.memory.channel)),
        approvals: renderRecords("Pending Approvals", snapshot.memory.pendingApprovals),
        archive: renderRecords("Archived Memory", snapshot.memory.archived),
        sources: renderSources(snapshot),
        janitor: renderRecords("Janitor Digests", snapshot.memory.janitorDigests)
      };
      document.getElementById("content").innerHTML = sections[state.active];
    }
    function renderConfig(snapshot) {
      const cfg = snapshot.config;
      return '<section class="active stack"><h2>Config</h2><div class="grid">' +
        card("Providers", '<p><strong>Prompt</strong><br><code>' + esc(cfg.promptProvider) + '</code></p><p><strong>Agent</strong><br><code>' + esc(cfg.agentProvider) + '</code></p><p><strong>Model</strong><br><code>' + esc(cfg.model) + '</code></p>') +
        card("Discord", '<p><strong>Task Channel</strong><br><code>' + esc(cfg.channelId) + '</code></p><p><strong>Detailed Config</strong><br><code>dashboard</code></p>') +
        card("Restrictions", '<p><code>' + esc(snapshot.restrictions.channelBoundaries) + '</code></p><p><code>' + esc(snapshot.restrictions.approvalBoundary) + '</code></p>') +
        card("Dashboard", '<p><strong>Host</strong><br><code>' + esc(cfg.dashboard.host) + '</code></p><p><strong>Port</strong><br><code>' + esc(cfg.dashboard.port) + '</code></p>') +
      '</div></section>';
    }
    function renderTree(snapshot) {
      const rows = snapshot.restrictions.nodePermissions.map((node) => '<tr><td>' + esc(node.kind) + '</td><td>' + esc(node.name) + '</td><td><code>' + esc(node.id) + '</code></td><td>' + esc(node.approvalPolicy) + '</td><td>' + esc(node.ownerUserIds.join(", ") || "none") + '</td><td>' + esc(node.approvedRoleIds.join(", ") || "none") + '</td></tr>').join("");
      return '<section class="active stack"><h2>Context Tree</h2><table class="table"><thead><tr><th>Kind</th><th>Name</th><th>ID</th><th>Approval</th><th>Owners</th><th>Roles</th></tr></thead><tbody>' + (rows || "<tr><td colspan='6'>No context nodes registered.</td></tr>") + '</tbody></table></section>';
    }
    function renderRecords(title, records) {
      return '<section class="active stack"><h2>' + esc(title) + '</h2><div class="grid">' + (records.length ? records.map(recordCard).join("") : card("Empty", "<p>No records.</p>")) + '</div></section>';
    }
    function renderSources(snapshot) {
      const auditRows = snapshot.sourceHistory.auditEvents.slice(0, 80).map((event) => '<tr><td>' + esc(event.createdAt) + '</td><td>' + esc(event.action) + '</td><td><code>' + esc(event.memoryId) + '</code></td><td>' + esc(event.actor) + '</td><td>' + esc(event.note) + '</td></tr>').join("");
      const logRows = snapshot.sourceHistory.threadLogs.slice(0, 80).map((entry) => '<tr><td>' + esc(entry.createdAt) + '</td><td>' + esc(entry.role) + '</td><td><code>' + esc(entry.threadId) + '</code></td><td>' + esc(entry.discordMessageId) + '</td><td>' + esc(entry.content) + '</td></tr>').join("");
      return '<section class="active stack"><h2>Source History</h2><table class="table"><thead><tr><th>Time</th><th>Action</th><th>Memory</th><th>Actor</th><th>Note</th></tr></thead><tbody>' + (auditRows || "<tr><td colspan='5'>No audit events.</td></tr>") + '</tbody></table><table class="table"><thead><tr><th>Time</th><th>Role</th><th>Thread</th><th>Message</th><th>Content</th></tr></thead><tbody>' + (logRows || "<tr><td colspan='5'>No thread logs.</td></tr>") + '</tbody></table></section>';
    }
    fetch("/api/dashboard").then((response) => response.json()).then((snapshot) => {
      state.snapshot = snapshot;
      render();
    }).catch((error) => {
      document.getElementById("content").innerHTML = '<section class="active"><h2>Error</h2><pre>' + esc(error.message) + '</pre></section>';
    });
  </script>
</body>
</html>`
}
