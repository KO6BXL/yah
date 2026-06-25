import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type Category,
    type Channel,
    type MemoryKind,
    type MemoryScope,
    type Thread,
    toDiscordCategoryId,
    toDiscordChannelId,
    toDiscordGuildId,
    toDiscordMessageId,
    toDiscordThreadId,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { MemoryStore, type MemoryRecordInput } from "../store/memoryStore.ts";
import { SecretStore } from "../store/secretStore.ts";
import { ContextAssembly } from "./assembly.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-contextassembly-"))
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

describe("ContextAssembly memory retrieval", () => {
    test("injects working memory nearest-first and pinned channel/category memory with source summaries", async () => {
        const {category, channel, thread} = await writeContextTree()

        await MemoryStore.create(memoryInput({
            scope: "category",
            nodeId: category.id,
            kind: "semantic",
            content: "Shared preference: use concise engineering feedback.",
            userApproved: true,
        }))
        await MemoryStore.create(memoryInput({
            scope: "channel",
            nodeId: channel.id,
            kind: "semantic",
            content: "Channel fact: the YAH repo lives in /home/me1on/proj/yah.",
        }))
        await MemoryStore.create(memoryInput({
            scope: "channel",
            nodeId: channel.id,
            kind: "working",
            content: "Channel working item: complete roadmap section 9.",
        }))
        await MemoryStore.create(memoryInput({
            scope: "thread",
            nodeId: thread.id,
            kind: "working",
            content: "Thread working item: update context assembly.",
        }))

        const context = await ContextAssembly.assembleForThread(thread.id, "Base instructions")
        const prompt = context.systemPrompt

        expect(prompt).toContain("## Relevant Working Memory")
        expect(prompt.indexOf("Thread working memory:")).toBeLessThan(prompt.indexOf("Channel working memory:"))
        expect(prompt).toContain("Thread working item: update context assembly.")
        expect(prompt).toContain("Channel working item: complete roadmap section 9.")
        expect(prompt).toContain("## Pinned Channel Memory")
        expect(prompt).toContain("[channel/semantic/not user-approved]")
        expect(prompt).toContain("source createdBy=agent message=400")
        expect(prompt).toContain("## Pinned Category Memory")
        expect(prompt).toContain("[category/semantic/approved]")
        expect(prompt).toContain("## Memory Conflict Rules")
        expect(prompt).toContain("Do not automatically merge conflicting memories.")
    })
})

async function writeContextTree() {
    const now = new Date().toISOString()
    const permissions = {
        ownerUserIds: ["500"],
        approvedRoleIds: [],
        approvalPolicy: "owner" as const,
    }
    const category: Category = {
        kind: "category",
        id: toDiscordCategoryId("100"),
        guildId: toDiscordGuildId("1"),
        name: "YAH",
        createdAt: now,
        updatedAt: now,
        permissions,
    }
    const channel: Channel = {
        kind: "channel",
        id: toDiscordChannelId("200"),
        guildId: category.guildId,
        parentCategoryId: category.id,
        name: "Programming",
        createdAt: now,
        updatedAt: now,
        permissions,
    }
    const thread: Thread = {
        kind: "thread",
        id: toDiscordThreadId("300"),
        guildId: category.guildId,
        parentCategoryId: category.id,
        parentChannelId: channel.id,
        startedByUserId: "500",
        sourceMessageId: toDiscordMessageId("400"),
        name: "Roadmap section 9",
        createdAt: now,
        updatedAt: now,
        permissions,
    }

    await ContextStore.writeCategory(category)
    await ContextStore.writeChannel(channel)
    await ContextStore.writeThread(thread)
    return {category, channel, thread}
}

function memoryInput(options: {
    scope: MemoryScope
    nodeId: MemoryRecordInput["nodeId"]
    kind: MemoryKind
    content: string
    userApproved?: boolean
}): MemoryRecordInput {
    return {
        scope: options.scope,
        nodeId: options.nodeId,
        kind: options.kind,
        status: "active",
        content: options.content,
        tags: [],
        confidence: 0.8,
        agentWritable: true,
        userApproved: options.userApproved ?? false,
        visibility: options.scope === "category" ? "category" : "channel",
        source: {
            createdBy: options.userApproved ? "user" : "agent",
            discordMessageId: toDiscordMessageId("400"),
        },
    } as MemoryRecordInput
}
