import {
    toDiscordMessageId,
    toDiscordThreadId,
    type MemoryKind,
    type MemoryRecord,
    type MemoryScope,
    type Thread,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { MemoryStore, type MemoryRecordInput } from "../store/memoryStore.ts";
import { ThreadLogStore, type ThreadLogEntry } from "../store/threadLogStore.ts";

export type ThreadCompletionResult = {
    thread: Thread
    summary: MemoryRecord
    promotions: MemoryRecord[]
    archivedThreadWorkingMemory: MemoryRecord[]
}

export class ThreadCompletion {
    public static async completeThread(threadIdRaw: string, completedByUserId: string, sourceMessageId?: string): Promise<ThreadCompletionResult> {
        const threadId = toDiscordThreadId(threadIdRaw)
        const thread = await ContextStore.readThread(threadId)
        if (!thread) {
            throw new Error(`Thread ${threadId} is not registered in context storage.`)
        }

        const now = new Date().toISOString()
        const completedThread: Thread = {
            ...thread,
            completedAt: thread.completedAt ?? now,
            updatedAt: now,
        }
        await ContextStore.writeThread(completedThread)

        await ThreadLogStore.append({
            threadId,
            role: "system",
            content: `Thread marked complete by Discord user ${completedByUserId}.`,
            discordMessageId: sourceMessageId ? toDiscordMessageId(sourceMessageId) : undefined,
            createdAt: now,
        })

        const logs = await ThreadLogStore.list(threadId)
        const threadWorkingMemory = await MemoryStore.list({
            scope: "thread",
            nodeId: threadId,
            kind: "working",
            status: "active",
        })
        const summaryText = ThreadCompletion.summarize(completedThread, logs, threadWorkingMemory)
        const source = {
            createdBy: "agent" as const,
            discordGuildId: completedThread.guildId,
            discordChannelId: completedThread.parentChannelId,
            discordThreadId: completedThread.id,
            discordMessageId: sourceMessageId ? toDiscordMessageId(sourceMessageId) : completedThread.sourceMessageId,
        }

        const summary = await MemoryStore.create({
            scope: "thread",
            nodeId: completedThread.id,
            kind: "episodic",
            status: "active",
            content: summaryText,
            tags: ["thread-completion", "summary"],
            confidence: 0.7,
            agentWritable: false,
            userApproved: false,
            visibility: "channel",
            source,
        }, completedByUserId)

        const promotions = await Promise.all(ThreadCompletion.promotionInputs(completedThread, summaryText, source)
            .map((input) => MemoryStore.create(input, completedByUserId)))

        const archivedThreadWorkingMemory = await Promise.all(
            threadWorkingMemory.map((record) => MemoryStore.archive(record.id, completedByUserId)),
        )

        return {
            thread: completedThread,
            summary,
            promotions,
            archivedThreadWorkingMemory,
        }
    }

    public static renderResult(result: ThreadCompletionResult) {
        const lines = [
            "Thread marked complete.",
            "",
            "Summary:",
            result.summary.content,
            "",
            `Memory proposals created: ${result.promotions.length}`,
            `Thread working memories archived: ${result.archivedThreadWorkingMemory.length}`,
            "Raw thread logs were retained as evidence only.",
        ]
        return lines.join("\n")
    }

    private static summarize(thread: Thread, logs: ThreadLogEntry[], threadWorkingMemory: MemoryRecord[]) {
        const userMessages = logs.filter((entry) => entry.role === "user")
        const assistantMessages = logs.filter((entry) => entry.role === "assistant")
        const lastUserMessage = ThreadCompletion.lastContent(userMessages)
        const lastAssistantMessage = ThreadCompletion.lastContent(assistantMessages)
        const workingItems = threadWorkingMemory
            .map((record) => record.content.trim())
            .filter((content) => content.length > 0)
            .slice(0, 5)

        return [
            `Completed thread "${thread.name}" (${thread.id}).`,
            `Activity: ${userMessages.length} user message(s), ${assistantMessages.length} assistant response(s).`,
            lastUserMessage ? `Last user request: ${ThreadCompletion.truncate(lastUserMessage, 280)}` : "Last user request: unavailable.",
            lastAssistantMessage ? `Last assistant response: ${ThreadCompletion.truncate(lastAssistantMessage, 280)}` : "Last assistant response: unavailable.",
            workingItems.length > 0 ? `Thread working context archived: ${workingItems.join(" | ")}` : "Thread working context archived: none.",
        ].join("\n")
    }

    private static promotionInputs(thread: Thread, summary: string, source: MemoryRecordInput["source"]) {
        const channelProposal = ThreadCompletion.memoryInput({
            scope: "channel",
            nodeId: thread.parentChannelId,
            kind: "episodic",
            content: `Thread completion summary for "${thread.name}":\n${summary}`,
            tags: ["thread-completion", "promotion-candidate"],
            source,
        })

        const categoryProposal = ThreadCompletion.memoryInput({
            scope: "category",
            nodeId: thread.parentCategoryId,
            kind: "episodic",
            content: `Candidate category memory from completed thread "${thread.name}". Review before approving because category memory affects all channels.\n${summary}`,
            tags: ["thread-completion", "promotion-candidate", "category-review"],
            source,
        })

        return [channelProposal, categoryProposal]
    }

    private static memoryInput(options: {
        scope: MemoryScope
        nodeId: MemoryRecordInput["nodeId"]
        kind: MemoryKind
        content: string
        tags: string[]
        source: MemoryRecordInput["source"]
    }): MemoryRecordInput {
        return {
            scope: options.scope,
            nodeId: options.nodeId,
            kind: options.kind,
            status: "proposed",
            content: options.content,
            tags: options.tags,
            confidence: 0.65,
            agentWritable: false,
            userApproved: false,
            visibility: options.scope === "category" ? "category" : "channel",
            source: options.source,
        } as MemoryRecordInput
    }

    private static lastContent(entries: ThreadLogEntry[]) {
        return entries.at(-1)?.content.trim()
    }

    private static truncate(text: string, limit: number) {
        const normalized = text.replace(/\s+/g, " ").trim()
        if (normalized.length <= limit) {
            return normalized
        }
        return `${normalized.slice(0, limit - 3)}...`
    }
}
