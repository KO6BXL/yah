import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryKinds, memoryScopes, memoryStatuses, type MemoryRecord, type MemoryScope } from "../domain/context.ts";
import { type Config } from "../store/config.ts";
import { ContextStore } from "../store/contextStore.ts";
import {
    MemoryStore,
    type MemoryAuditEvent,
    type MemoryListFilter,
    type MemoryRecordUpdate,
} from "../store/memoryStore.ts";
import { ThreadLogStore, type ThreadLogEntry } from "../store/threadLogStore.ts";

type DashboardConfig = Config["dashboard"]

const dashboardPublicDir = join(dirname(fileURLToPath(import.meta.url)), "public")

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
    public readonly app: Express
    private server?: Server

    constructor(private readonly config: Config) {
        this.app = express()
        this.configureRoutes()
    }

    public start() {
        if (!this.config.dashboard.enabled || this.server) {
            return
        }

        this.server = createServer(this.app)
        this.server.listen(this.config.dashboard.port, this.config.dashboard.host, () => {
            const address = this.server?.address()
            const port = typeof address === "object" && address ? address.port : this.config.dashboard.port
            console.log(`YAH dashboard listening on http://${this.config.dashboard.host}:${port}`)
        })
    }

    public dispose() {
        this.server?.close()
        this.server = undefined
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

    private configureRoutes() {
        this.app.disable("x-powered-by")
        this.app.use(express.json({limit: "1mb"}))
        this.app.get("/api/dashboard", (req, res) => {
            void Dashboard.snapshot(this.config)
                .then((snapshot) => res.json(snapshot))
                .catch((error) => Dashboard.sendError(res, error))
        })
        this.app.get("/api/config", (_req, res) => {
            res.json(Dashboard.publicConfig(this.config))
        })
        this.app.get("/api/memory", (req, res) => {
            void Dashboard.listMemory(req)
                .then((records) => res.json(records))
                .catch((error) => Dashboard.sendError(res, error, 400))
        })
        this.app.patch("/api/memory/:id", (req, res) => {
            void Dashboard.updateMemory(req, res)
        })
        this.app.post("/api/memory/:id/archive", (req, res) => {
            void Dashboard.archiveMemory(req, res)
        })
        this.app.post("/api/memory/:id/restore", (req, res) => {
            void Dashboard.restoreMemory(req, res)
        })
        this.app.post("/api/memory/:id/delete", (req, res) => {
            void Dashboard.deleteMemory(req, res)
        })
        this.app.post("/api/memory/:id/move", (req, res) => {
            void Dashboard.moveMemory(req, res)
        })
        this.app.use(express.static(dashboardPublicDir))
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

    private static async listMemory(req: Request) {
        const filter: MemoryListFilter = {}
        const scope = Dashboard.queryString(req, "scope")
        const kind = Dashboard.queryString(req, "kind")
        const status = Dashboard.queryString(req, "status")
        if (scope) {
            if (!Dashboard.isAllowed(scope, memoryScopes)) {
                throw new Error(`Unsupported memory scope: ${scope}`)
            }
            filter.scope = scope
        }
        if (kind) {
            if (!Dashboard.isAllowed(kind, memoryKinds)) {
                throw new Error(`Unsupported memory kind: ${kind}`)
            }
            filter.kind = kind
        }
        if (status) {
            if (!Dashboard.isAllowed(status, memoryStatuses)) {
                throw new Error(`Unsupported memory status: ${status}`)
            }
            filter.status = status
        }
        filter.nodeId = Dashboard.queryString(req, "nodeId")
        filter.text = Dashboard.queryString(req, "q") ?? Dashboard.queryString(req, "text")
        const records = await MemoryStore.list(filter)
        return records
            .map((record) => Dashboard.memoryView(record))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }

    private static async updateMemory(req: Request, res: Response) {
        try {
            const id = Dashboard.paramString(req, "id")
            const record = await MemoryStore.update(id, Dashboard.memoryUpdateFrom(req.body), Dashboard.actorFrom(req))
            res.json(Dashboard.memoryView(record))
        } catch (error) {
            Dashboard.sendMemoryError(res, error)
        }
    }

    private static async archiveMemory(req: Request, res: Response) {
        try {
            const record = await MemoryStore.archive(Dashboard.paramString(req, "id"), Dashboard.actorFrom(req))
            res.json(Dashboard.memoryView(record))
        } catch (error) {
            Dashboard.sendMemoryError(res, error)
        }
    }

    private static async restoreMemory(req: Request, res: Response) {
        try {
            const record = await MemoryStore.restore(Dashboard.paramString(req, "id"), Dashboard.actorFrom(req))
            res.json(Dashboard.memoryView(record))
        } catch (error) {
            Dashboard.sendMemoryError(res, error)
        }
    }

    private static async deleteMemory(req: Request, res: Response) {
        try {
            const actor = Dashboard.actorFrom(req)
            if (!actor) {
                res.status(400).json({error: "Deleting memory requires an actor."})
                return
            }
            const record = await MemoryStore.markDeleted(Dashboard.paramString(req, "id"), actor)
            res.json(Dashboard.memoryView(record))
        } catch (error) {
            Dashboard.sendMemoryError(res, error)
        }
    }

    private static async moveMemory(req: Request, res: Response) {
        try {
            const scope = Dashboard.stringField(req.body, "scope")
            const nodeId = Dashboard.stringField(req.body, "nodeId")
            if (!Dashboard.isAllowed(scope, memoryScopes)) {
                res.status(400).json({error: `Unsupported memory scope: ${scope}`})
                return
            }
            const record = await MemoryStore.move(Dashboard.paramString(req, "id"), scope as MemoryScope, nodeId, Dashboard.actorFrom(req))
            res.json(Dashboard.memoryView(record))
        } catch (error) {
            Dashboard.sendMemoryError(res, error)
        }
    }

    private static actorFrom(req: Request) {
        const actor = req.header("x-yah-actor") ?? Dashboard.bodyString(req.body, "actor")
        return actor && actor.trim().length > 0 ? actor.trim() : undefined
    }

    private static memoryUpdateFrom(body: unknown): MemoryRecordUpdate {
        if (!Dashboard.isObject(body)) {
            return {}
        }
        const update: MemoryRecordUpdate = {}
        const assign = <Key extends keyof MemoryRecordUpdate>(key: Key) => {
            if (body[key] !== undefined) {
                update[key] = body[key] as MemoryRecordUpdate[Key]
            }
        }
        assign("kind")
        assign("status")
        assign("content")
        assign("tags")
        assign("confidence")
        assign("agentWritable")
        assign("userApproved")
        assign("visibility")
        assign("source")
        assign("validFrom")
        assign("validUntil")
        assign("supersedes")
        assign("supersededBy")
        assign("approvedByUserId")
        assign("approvedAt")
        return update
    }

    private static stringField(body: unknown, field: string) {
        const value = Dashboard.bodyString(body, field)
        if (!value || value.trim().length === 0) {
            throw new Error(`${field} must be a non-empty string.`)
        }
        return value.trim()
    }

    private static queryString(req: Request, field: string) {
        const value = req.query[field]
        if (Array.isArray(value)) {
            return typeof value[0] === "string" ? value[0] : undefined
        }
        return typeof value === "string" ? value : undefined
    }

    private static paramString(req: Request, field: string) {
        const value = req.params[field]
        if (Array.isArray(value)) {
            return value[0]
        }
        if (typeof value !== "string" || value.length === 0) {
            throw new Error(`${field} route parameter is required.`)
        }
        return value
    }

    private static bodyString(body: unknown, field: string) {
        if (!Dashboard.isObject(body)) {
            return undefined
        }
        const value = body[field]
        return typeof value === "string" ? value : undefined
    }

    private static isObject(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    }

    private static isAllowed<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
        return allowed.includes(value)
    }

    private static sendMemoryError(res: Response, error: unknown) {
        const message = error instanceof Error ? error.message : "Dashboard memory request failed."
        Dashboard.sendError(res, error, message.includes("was not found") ? 404 : 400)
    }

    private static sendError(res: Response, error: unknown, status = 500) {
        const message = error instanceof Error ? error.message : "Dashboard request failed."
        res.status(status).json({error: message})
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
