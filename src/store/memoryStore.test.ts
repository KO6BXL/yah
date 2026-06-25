import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type MemoryKind,
    type MemoryScope,
    toDiscordCategoryId,
    toDiscordChannelId,
    toDiscordThreadId,
} from "../domain/context.ts";
import { SecretStore } from "./secretStore.ts";
import { MemoryStore, type MemoryRecordInput } from "./memoryStore.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-memorystore-"))
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

describe("MemoryStore write rules", () => {
    test("allows agents to write thread working memory", async () => {
        const record = await MemoryStore.create(memoryInput({
            scope: "thread",
            nodeId: "300",
            kind: "working",
            status: "active",
            content: "Need to verify the deployment target.",
        }))

        expect(record.scope).toBe("thread")
        expect(record.kind).toBe("working")
        expect(record.status).toBe("active")
    })

    test("allows agents to write channel working memory", async () => {
        const record = await MemoryStore.create(memoryInput({
            scope: "channel",
            nodeId: "200",
            kind: "working",
            status: "active",
            content: "Current project is the YAH memory overhaul.",
        }))

        expect(record.scope).toBe("channel")
        expect(record.kind).toBe("working")
        expect(record.status).toBe("active")
    })

    test("marks agent-created durable channel memory clearly", async () => {
        const record = await MemoryStore.create(memoryInput({
            scope: "channel",
            nodeId: "200",
            kind: "semantic",
            status: "active",
            content: "The Programming channel works in ~/proj by default.",
        }))

        expect(record.tags).toContain("agent-created")
        expect(record.agentWritable).toBe(false)
        expect(record.userApproved).toBe(false)
    })

    test("requires proposals for agent-created category memory", async () => {
        await expect(MemoryStore.create(memoryInput({
            scope: "category",
            nodeId: "100",
            kind: "semantic",
            status: "active",
            content: "The user prefers concise engineering feedback.",
        }))).rejects.toThrow("category memory must be proposed")

        await expect(MemoryStore.create(memoryInput({
            scope: "category",
            nodeId: "100",
            kind: "semantic",
            status: "proposed",
            content: "The user prefers concise engineering feedback.",
        }))).resolves.toMatchObject({status: "proposed"})
    })

    test("requires proposals for agent-created task and procedural memory", async () => {
        for (const kind of ["task", "procedural"] as const) {
            await expect(MemoryStore.create(memoryInput({
                scope: "channel",
                nodeId: "200",
                kind,
                status: "active",
                content: `${kind} memories require user approval.`,
            }))).rejects.toThrow("task and procedural memory changes must be proposed")
        }
    })

    test("prevents agents from silently overwriting active durable facts", async () => {
        const record = await MemoryStore.create(memoryInput({
            scope: "channel",
            nodeId: "200",
            kind: "semantic",
            status: "active",
            content: "The user prefers short replies.",
            sourceCreatedBy: "user",
            userApproved: true,
        }))

        await expect(MemoryStore.update(record.id, {
            content: "The user prefers long replies.",
            source: {...record.source, createdBy: "agent"},
        })).rejects.toThrow("cannot be silently overwritten")

        await expect(MemoryStore.supersede(record.id, memoryInput({
            scope: "channel",
            nodeId: "200",
            kind: "semantic",
            status: "proposed",
            content: "The user prefers detailed replies for planning tasks.",
        }))).resolves.toMatchObject({
            superseded: {status: "superseded"},
            replacement: {status: "proposed"},
        })
    })
})

function memoryInput(options: {
    scope: MemoryScope
    nodeId: string
    kind: MemoryKind
    status: MemoryRecordInput["status"]
    content: string
    sourceCreatedBy?: MemoryRecordInput["source"]["createdBy"]
    userApproved?: boolean
}): MemoryRecordInput {
    const base = {
        kind: options.kind,
        status: options.status,
        content: options.content,
        tags: [],
        confidence: 0.8,
        agentWritable: true,
        userApproved: options.userApproved ?? false,
        visibility: options.scope === "category" ? "category" : "channel",
        source: {
            createdBy: options.sourceCreatedBy ?? "agent",
        },
    } satisfies Omit<MemoryRecordInput, "scope" | "nodeId">

    if (options.scope === "category") {
        return {
            ...base,
            scope: "category",
            nodeId: toDiscordCategoryId(options.nodeId),
        }
    }

    if (options.scope === "channel") {
        return {
            ...base,
            scope: "channel",
            nodeId: toDiscordChannelId(options.nodeId),
        }
    }

    return {
        ...base,
        scope: options.scope,
        nodeId: toDiscordThreadId(options.nodeId),
    }
}
