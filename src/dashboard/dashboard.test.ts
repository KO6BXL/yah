import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dashboard } from "./dashboard.ts";
import {
    toDiscordCategoryId,
    toDiscordChannelId,
    toDiscordGuildId,
    toDiscordThreadId,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { MemoryStore } from "../store/memoryStore.ts";
import { SecretStore } from "../store/secretStore.ts";
import { ThreadLogStore } from "../store/threadLogStore.ts";
import { type Config } from "../store/config.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-dashboard-"))
    SecretStore.set("DATA_DIR", dataDir)
})

afterEach(async () => {
    if (previousDataDir === undefined) {
        delete process.env.DATA_DIR
    } else {
        SecretStore.set("DATA_DIR", previousDataDir)
    }
    await rm(dataDir, {recursive: true, force: true})
})

describe("Dashboard", () => {
    test("builds an inspectable snapshot from context, memory, audit, and logs", async () => {
        const guildId = toDiscordGuildId("100")
        const categoryId = toDiscordCategoryId("200")
        const channelId = toDiscordChannelId("300")
        const threadId = toDiscordThreadId("400")
        const permissions = {
            ownerUserIds: ["user-1"],
            approvedRoleIds: ["role-1"],
            approvalPolicy: "category-owner" as const,
        }
        await ContextStore.writeCategory({
            kind: "category",
            id: categoryId,
            guildId,
            name: "YAH",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions,
        })
        await ContextStore.writeChannel({
            kind: "channel",
            id: channelId,
            parentCategoryId: categoryId,
            guildId,
            name: "Programming",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions: {...permissions, approvalPolicy: "channel-owner"},
        })
        await ContextStore.writeThread({
            kind: "thread",
            id: threadId,
            parentCategoryId: categoryId,
            parentChannelId: channelId,
            guildId,
            name: "Dashboard work",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions: {...permissions, approvalPolicy: "channel-owner"},
            startedByUserId: "user-1",
        })
        await ThreadLogStore.append({
            threadId,
            role: "user",
            content: "Build dashboard foundation.",
            createdAt: "2026-06-25T00:01:00.000Z",
        })
        const proposal = await MemoryStore.create({
            scope: "category",
            nodeId: categoryId,
            kind: "semantic",
            status: "proposed",
            content: "The dashboard owns detailed configuration.",
            tags: ["dashboard"],
            confidence: 0.8,
            agentWritable: false,
            userApproved: false,
            visibility: "category",
            source: {
                createdBy: "agent",
                discordGuildId: guildId,
                discordChannelId: channelId,
                discordThreadId: threadId,
            },
            updatedAt: "2026-06-25T00:02:00.000Z",
        }, "agent")
        await MemoryStore.create({
            scope: "channel",
            nodeId: channelId,
            kind: "episodic",
            status: "active",
            content: "Janitor digest for #Programming since 2026-06-25.",
            tags: ["janitor-digest"],
            confidence: 0.9,
            agentWritable: false,
            userApproved: false,
            visibility: "channel",
            source: {createdBy: "janitor", discordGuildId: guildId, discordChannelId: channelId},
        }, "janitor")

        const snapshot = await Dashboard.snapshot(config(channelId))

        expect(snapshot.context.categories).toHaveLength(1)
        expect(snapshot.restrictions.discordIsTaskInput).toBe(true)
        expect(snapshot.restrictions.nodePermissions.map((node) => node.id)).toContain(channelId)
        expect(snapshot.memory.pendingApprovals.map((record) => record.id)).toContain(proposal.id)
        expect(snapshot.memory.pendingApprovals[0].approvalSummary).toBe("pending approval")
        expect(snapshot.memory.pendingApprovals[0].sourceSummary).toContain(`thread:${threadId}`)
        expect(snapshot.memory.pendingApprovals[0].freshness).toBe("current")
        expect(snapshot.memory.janitorDigests).toHaveLength(1)
        expect(snapshot.sourceHistory.auditEvents.length).toBeGreaterThanOrEqual(2)
        expect(snapshot.sourceHistory.threadLogs).toHaveLength(1)
    })

    test("handles dashboard memory search and lifecycle writes with audit events", async () => {
        const channelId = toDiscordChannelId("300")
        const otherChannelId = toDiscordChannelId("301")
        const dashboard = new Dashboard(config(channelId))
        const memory = await MemoryStore.create({
            scope: "channel",
            nodeId: channelId,
            kind: "semantic",
            status: "active",
            content: "Dashboard memory can be edited through API routes.",
            tags: ["dashboard"],
            confidence: 0.7,
            agentWritable: false,
            userApproved: true,
            visibility: "channel",
            source: {createdBy: "user"},
        }, "user-1")

        await withDashboardServer(dashboard, async (baseUrl) => {
            const search = await fetch(`${baseUrl}/api/memory?q=edited`)
            expect(search.status).toBe(200)
            expect(await search.json()).toHaveLength(1)

            const updated = await fetch(`${baseUrl}/api/memory/${memory.id}`, {
                method: "PATCH",
                headers: {"content-type": "application/json", "x-yah-actor": "user-2"},
                body: JSON.stringify({
                    content: "Dashboard memory was edited through API routes.",
                    tags: ["dashboard", "api"],
                    confidence: 0.95,
                }),
            })
            expect(updated.status).toBe(200)
            expect((await updated.json()).content).toBe("Dashboard memory was edited through API routes.")

            const archived = await fetch(`${baseUrl}/api/memory/${memory.id}/archive`, {
                method: "POST",
                headers: {"x-yah-actor": "user-2"},
            })
            expect(archived.status).toBe(200)
            expect((await archived.json()).status).toBe("archived")

            const restored = await fetch(`${baseUrl}/api/memory/${memory.id}/restore`, {
                method: "POST",
                headers: {"x-yah-actor": "user-2"},
            })
            expect(restored.status).toBe(200)
            expect((await restored.json()).status).toBe("active")

            const moved = await fetch(`${baseUrl}/api/memory/${memory.id}/move`, {
                method: "POST",
                headers: {"content-type": "application/json", "x-yah-actor": "user-2"},
                body: JSON.stringify({scope: "channel", nodeId: otherChannelId}),
            })
            expect(moved.status).toBe(200)
            expect((await moved.json()).nodeId).toBe(otherChannelId)

            const deleted = await fetch(`${baseUrl}/api/memory/${memory.id}/delete`, {
                method: "POST",
                headers: {"x-yah-actor": "user-2"},
            })
            expect(deleted.status).toBe(200)
            expect((await deleted.json()).status).toBe("deleted")
        })

        const actions = (await MemoryStore.listAuditEvents())
            .filter((event) => event.memoryId === memory.id)
            .map((event) => event.action)
        expect(actions).toContain("update")
        expect(actions).toContain("archive")
        expect(actions).toContain("restore")
        expect(actions).toContain("move")
        expect(actions).toContain("mark-deleted")
    })

    test("handles proposal approval, rejection, and lower-scope moves", async () => {
        const guildId = toDiscordGuildId("100")
        const categoryId = toDiscordCategoryId("200")
        const channelId = toDiscordChannelId("300")
        const otherChannelId = toDiscordChannelId("301")
        const permissions = {
            ownerUserIds: ["user-1"],
            approvedRoleIds: ["role-1"],
            approvalPolicy: "owner" as const,
        }
        await ContextStore.writeCategory({
            kind: "category",
            id: categoryId,
            guildId,
            name: "YAH",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions,
        })
        await ContextStore.writeChannel({
            kind: "channel",
            id: channelId,
            parentCategoryId: categoryId,
            guildId,
            name: "Programming",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions,
        })
        await ContextStore.writeChannel({
            kind: "channel",
            id: otherChannelId,
            parentCategoryId: categoryId,
            guildId,
            name: "Email",
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
            permissions,
        })
        const dashboard = new Dashboard(config(channelId))
        const approval = await MemoryStore.create({
            scope: "category",
            nodeId: categoryId,
            kind: "semantic",
            status: "proposed",
            content: "Dashboard approvals are required.",
            tags: [],
            confidence: 0.7,
            agentWritable: false,
            userApproved: false,
            visibility: "category",
            source: {createdBy: "agent"},
        })
        const rejection = await MemoryStore.create({
            scope: "channel",
            nodeId: channelId,
            kind: "task",
            status: "proposed",
            content: "Reject this task proposal.",
            tags: [],
            confidence: 0.7,
            agentWritable: false,
            userApproved: false,
            visibility: "channel",
            source: {createdBy: "agent"},
        })
        const movedProposal = await MemoryStore.create({
            scope: "category",
            nodeId: categoryId,
            kind: "semantic",
            status: "proposed",
            content: "Move this proposal lower.",
            tags: [],
            confidence: 0.7,
            agentWritable: false,
            userApproved: false,
            visibility: "category",
            source: {createdBy: "agent"},
        })

        await withDashboardServer(dashboard, async (baseUrl) => {
            const denied = await fetch(`${baseUrl}/api/memory/${approval.id}/approve`, {
                method: "POST",
                headers: {"x-yah-actor": "user-2"},
            })
            expect(denied.status).toBe(400)

            const approved = await fetch(`${baseUrl}/api/memory/${approval.id}/approve`, {
                method: "POST",
                headers: {"content-type": "application/json", "x-yah-actor": "user-1"},
                body: JSON.stringify({
                    content: "Dashboard approval is required for shared memory.",
                    tags: ["approval"],
                }),
            })
            expect(approved.status).toBe(200)
            const approvedBody = await approved.json()
            expect(approvedBody.status).toBe("active")
            expect(approvedBody.approvalSummary).toContain("approved by user-1")

            const rejected = await fetch(`${baseUrl}/api/memory/${rejection.id}/reject`, {
                method: "POST",
                headers: {"x-yah-actor": "user-3", "x-yah-roles": "role-1"},
            })
            expect(rejected.status).toBe(200)
            expect((await rejected.json()).status).toBe("archived")

            const moved = await fetch(`${baseUrl}/api/memory/${movedProposal.id}/move-lower`, {
                method: "POST",
                headers: {"content-type": "application/json", "x-yah-actor": "user-1"},
                body: JSON.stringify({scope: "channel", nodeId: otherChannelId}),
            })
            expect(moved.status).toBe(200)
            expect((await moved.json()).nodeId).toBe(otherChannelId)
        })

        const actions = (await MemoryStore.listAuditEvents()).map((event) => event.action)
        expect(actions).toContain("approve")
        expect(actions).toContain("reject")
    })

    test("serves dashboard html and static assets through express", async () => {
        const dashboard = new Dashboard(config(toDiscordChannelId("300")))

        await withDashboardServer(dashboard, async (baseUrl) => {
            const html = await fetch(`${baseUrl}/`)
            expect(html.status).toBe(200)
            expect(html.headers.get("content-type")).toContain("text/html")
            expect(await html.text()).toContain('<script type="module" src="/app.js"></script>')

            const script = await fetch(`${baseUrl}/app.js`)
            expect(script.status).toBe(200)
            expect(await script.text()).toContain('fetch("/api/dashboard")')
        })
    })
})

function config(channelId: string): Config {
    return {
        promptProvider: "discord",
        agentProvider: "openai",
        model: "gpt-5",
        channelId,
        dashboard: {
            enabled: false,
            host: "127.0.0.1",
            port: 8787,
        },
    }
}

async function withDashboardServer(dashboard: Dashboard, run: (baseUrl: string) => Promise<void>) {
    const server = await new Promise<Server>((resolve) => {
        const listening = dashboard.app.listen(0, "127.0.0.1", () => resolve(listening))
    })
    const address = server.address()
    if (!address || typeof address !== "object") {
        throw new Error("Dashboard test server did not bind to a TCP address.")
    }
    try {
        await run(`http://127.0.0.1:${address.port}`)
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve())
        })
    }
}
