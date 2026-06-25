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
import { Janitor } from "./janitor.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-janitor-"))
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

describe("Janitor", () => {
    test("skips channels with no relevant activity since the last interval", async () => {
        const {channel} = await writeContextTree()

        const result = await Janitor.runChannel(channel.id, {intervalMs: 60_000})

        expect(result.skipped).toBe(true)
        expect(result.archived).toHaveLength(0)
        expect(result.candidates).toHaveLength(0)
    })

    test("archives stale working memory, summarizes completed threads, proposes candidates, and writes a digest", async () => {
        const {category, channel, thread} = await writeContextTree({completed: true})
        const duplicateSemanticContent = `Candidate durable fact from thread ${thread.id}: The repo lives in /home/me1on/proj/yah.`

        await ThreadLogStore.append({
            threadId: thread.id,
            role: "user",
            content: "When finishing a roadmap section, always update ROADMAP.md.",
            discordMessageId: toDiscordMessageId("401"),
        })
        await ThreadLogStore.append({
            threadId: thread.id,
            role: "assistant",
            content: "The repo lives in /home/me1on/proj/yah.",
        })
        await ThreadLogStore.append({
            threadId: thread.id,
            role: "assistant",
            content: "The dashboard uses memory proposals for review.",
        })
        await ThreadLogStore.append({
            threadId: thread.id,
            role: "assistant",
            content: "Artifact: https://example.com/report",
        })
        const threadWorking = await MemoryStore.create({
            scope: "thread",
            nodeId: thread.id,
            kind: "working",
            status: "active",
            content: "Thread scratch item that should close with the completed thread.",
            tags: [],
            confidence: 0.8,
            agentWritable: true,
            userApproved: false,
            visibility: "channel",
            source: {createdBy: "agent", discordThreadId: thread.id},
        } as MemoryRecordInput)
        const channelWorking = await MemoryStore.create({
            scope: "channel",
            nodeId: channel.id,
            kind: "working",
            status: "active",
            content: "Expired channel working note.",
            tags: ["stale"],
            confidence: 0.8,
            agentWritable: true,
            userApproved: false,
            visibility: "channel",
            source: {createdBy: "agent", discordChannelId: channel.id},
        } as MemoryRecordInput)
        await MemoryStore.create({
            scope: "channel",
            nodeId: channel.id,
            kind: "semantic",
            status: "proposed",
            content: duplicateSemanticContent,
            tags: ["janitor-candidate", "semantic-review"],
            confidence: 0.55,
            agentWritable: false,
            userApproved: false,
            visibility: "channel",
            source: {
                createdBy: "janitor",
                discordGuildId: category.guildId,
                discordChannelId: channel.id,
                discordThreadId: thread.id,
            },
        } as MemoryRecordInput)

        const result = await Janitor.runChannel(channel.id, {intervalMs: 24 * 60 * 60 * 1000})
        const archivedThreadWorking = await MemoryStore.read(threadWorking.id)
        const archivedChannelWorking = await MemoryStore.read(channelWorking.id)
        const activeThreadSummaries = await MemoryStore.list({
            scope: "thread",
            nodeId: thread.id,
            kind: "episodic",
            status: "active",
        })
        const candidateKinds = new Set(result.candidates.map((record) => record.kind))

        expect(result.skipped).toBe(false)
        expect(archivedThreadWorking?.status).toBe("archived")
        expect(archivedChannelWorking?.status).toBe("archived")
        expect(activeThreadSummaries.some((record) => record.tags.includes("janitor-summary"))).toBe(true)
        expect(candidateKinds.has("semantic")).toBe(true)
        expect(candidateKinds.has("episodic")).toBe(true)
        expect(candidateKinds.has("procedural")).toBe(true)
        expect(candidateKinds.has("artifact")).toBe(true)
        expect(result.duplicateCandidatesSkipped).toBe(1)
        expect(result.digest?.tags).toContain("janitor-digest")
        expect(result.digest?.content).toContain("No memory was physically deleted.")
    })
})

async function writeContextTree(options: {completed?: boolean} = {}) {
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
        name: "Roadmap section 11",
        createdAt: now,
        updatedAt: now,
        completedAt: options.completed ? now : undefined,
        permissions,
    }

    await ContextStore.writeCategory(category)
    await ContextStore.writeChannel(channel)
    await ContextStore.writeThread(thread)
    return {category, channel, thread}
}
