import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type Category,
    type Channel,
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
import { ThreadLogStore } from "../store/threadLogStore.ts";
import { ThreadCompletion } from "./threadCompletion.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-threadcompletion-"))
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

describe("ThreadCompletion", () => {
    test("marks a thread complete, summarizes evidence, proposes promotions, and archives thread working memory", async () => {
        const {thread} = await writeContextTree()

        await ThreadLogStore.append({
            threadId: thread.id,
            role: "user",
            content: "Please finish roadmap section 10.",
            discordMessageId: toDiscordMessageId("401"),
        })
        await ThreadLogStore.append({
            threadId: thread.id,
            role: "assistant",
            content: "Implemented completion flow and tests.",
        })
        const working = await MemoryStore.create({
            scope: "thread",
            nodeId: thread.id,
            kind: "working",
            status: "active",
            content: "Need to archive this when section 10 is complete.",
            tags: [],
            confidence: 0.8,
            agentWritable: true,
            userApproved: false,
            visibility: "channel",
            source: {
                createdBy: "agent",
                discordThreadId: thread.id,
            },
        } as MemoryRecordInput)

        const result = await ThreadCompletion.completeThread(thread.id, "500", "402")
        const updatedThread = await ContextStore.readThread(thread.id)
        const archivedWorking = await MemoryStore.read(working.id)
        const proposals = await MemoryStore.list({status: "proposed"})
        const logs = await ThreadLogStore.list(thread.id)

        expect(updatedThread?.completedAt).toBeString()
        expect(result.summary.scope).toBe("thread")
        expect(result.summary.kind).toBe("episodic")
        expect(result.summary.content).toContain("Completed thread")
        expect(result.summary.content).toContain("Please finish roadmap section 10.")
        expect(proposals).toHaveLength(2)
        expect(proposals.map((record) => record.scope).sort()).toEqual(["category", "channel"])
        expect(archivedWorking?.status).toBe("archived")
        expect(logs.at(-1)?.role).toBe("system")
        expect(logs.at(-1)?.content).toContain("marked complete")
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
        name: "Roadmap section 10",
        createdAt: now,
        updatedAt: now,
        permissions,
    }

    await ContextStore.writeCategory(category)
    await ContextStore.writeChannel(channel)
    await ContextStore.writeThread(thread)
    return {category, channel, thread}
}
