import {
    toDiscordThreadId,
    type Category,
    type Channel,
    type MemoryRecord,
    type Thread,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { MemoryStore } from "../store/memoryStore.ts";

export type ContextSection = {
    title: string
    content: string
}

export type AssembledThreadContext = {
    threadId: string
    category?: Category
    channel?: Channel
    thread?: Thread
    sections: ContextSection[]
    systemPrompt: string
}

export class ContextAssembly {
    public static async assembleForThread(threadId: string, baseSystemInstructions: string): Promise<AssembledThreadContext> {
        const thread = await ContextStore.readThread(toDiscordThreadId(threadId))
        const channel = thread ? await ContextStore.readChannel(thread.parentChannelId) : undefined
        const category = thread ? await ContextStore.readCategory(thread.parentCategoryId) : undefined
        const memory = await ContextAssembly.memoryContext(category, channel, thread)

        const sections = [
            ContextAssembly.section("Base System Instructions", baseSystemInstructions),
            ContextAssembly.section("Category Task and Procedural Context", ContextAssembly.categoryContext(category)),
            ContextAssembly.section("Channel Task and Working Context", ContextAssembly.nodeContext(channel)),
            ContextAssembly.section("Thread Live Context", ContextAssembly.threadContext(thread)),
            ContextAssembly.section("Relevant Working Memory", memory.working),
            ContextAssembly.section("Pinned Channel Memory", memory.channelPinned),
            ContextAssembly.section("Pinned Category Memory", memory.categoryPinned),
            ContextAssembly.section("Memory Conflict Rules", ContextAssembly.conflictRules()),
        ]

        return {
            threadId,
            category,
            channel,
            thread,
            sections,
            systemPrompt: ContextAssembly.render(sections),
        }
    }

    private static nodeContext(node: Category | Channel | undefined) {
        if (!node) {
            return "No context record is registered for this node yet."
        }
        return [
            `Name: ${node.name}`,
            `ID: ${node.id}`,
            node.taskMemory ? `Task memory: ${node.taskMemory}` : "Task memory: unset",
            node.workingMemory ? `Working memory: ${node.workingMemory}` : "Working memory: unset",
        ].join("\n")
    }

    private static categoryContext(category: Category | undefined) {
        const baseContext = ContextAssembly.nodeContext(category)
        return [
            baseContext,
            "Procedural context: no structured procedural memory is registered yet.",
        ].join("\n")
    }

    private static threadContext(thread: Thread | undefined) {
        if (!thread) {
            return "No thread context record is registered yet. Treat this as an active Discord thread with no stored metadata."
        }
        return [
            `Name: ${thread.name}`,
            `ID: ${thread.id}`,
            `Parent category ID: ${thread.parentCategoryId}`,
            `Parent channel ID: ${thread.parentChannelId}`,
            `Started by user ID: ${thread.startedByUserId}`,
            thread.sourceMessageId ? `Source message ID: ${thread.sourceMessageId}` : "Source message ID: unset",
            thread.taskMemory ? `Task memory: ${thread.taskMemory}` : "Task memory: unset",
            thread.workingMemory ? `Working memory: ${thread.workingMemory}` : "Working memory: unset",
        ].join("\n")
    }

    private static async memoryContext(category: Category | undefined, channel: Channel | undefined, thread: Thread | undefined) {
        const [threadWorking, channelWorking, channelPinned, categoryPinned] = await Promise.all([
            thread ? MemoryStore.list({scope: "thread", nodeId: thread.id, kind: "working", status: "active"}) : [],
            channel ? MemoryStore.list({scope: "channel", nodeId: channel.id, kind: "working", status: "active"}) : [],
            channel ? MemoryStore.list({scope: "channel", nodeId: channel.id, status: "active"}) : [],
            category ? MemoryStore.list({scope: "category", nodeId: category.id, status: "active"}) : [],
        ])

        return {
            working: ContextAssembly.renderMemoryGroups([
                ["Thread working memory", threadWorking],
                ["Channel working memory", channelWorking],
            ], "No active thread or channel working memory is registered."),
            channelPinned: ContextAssembly.renderMemories(
                ContextAssembly.pinnedMemories(channelPinned),
                "No active pinned channel memory is registered.",
            ),
            categoryPinned: ContextAssembly.renderMemories(
                ContextAssembly.pinnedMemories(categoryPinned),
                "No active pinned category memory is registered.",
            ),
        }
    }

    private static pinnedMemories(records: MemoryRecord[]) {
        return records
            .filter((record) => record.kind !== "working")
            .sort(ContextAssembly.compareMemories)
    }

    private static renderMemoryGroups(groups: Array<[string, MemoryRecord[]]>, emptyMessage: string) {
        const rendered = groups
            .map(([title, records]) => {
                const content = ContextAssembly.renderMemories(records.sort(ContextAssembly.compareMemories), "")
                return content ? [`${title}:`, content].join("\n") : undefined
            })
            .filter((group): group is string => Boolean(group))

        return rendered.length > 0 ? rendered.join("\n\n") : emptyMessage
    }

    private static renderMemories(records: MemoryRecord[], emptyMessage: string) {
        if (records.length === 0) {
            return emptyMessage
        }
        return records.map((record) => {
            const source = ContextAssembly.memorySourceSummary(record)
            const approval = record.userApproved ? "approved" : "not user-approved"
            const tags = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : ""
            return `- [${record.scope}/${record.kind}/${approval}] ${record.content} (${source}; updated ${record.updatedAt}${tags})`
        }).join("\n")
    }

    private static memorySourceSummary(record: MemoryRecord) {
        const source = record.source
        const details = [
            `createdBy=${source.createdBy}`,
            source.discordMessageId ? `message=${source.discordMessageId}` : undefined,
            source.discordThreadId ? `thread=${source.discordThreadId}` : undefined,
            source.toolCallId ? `toolCall=${source.toolCallId}` : undefined,
            source.toolName ? `tool=${source.toolName}` : undefined,
        ].filter((detail): detail is string => Boolean(detail))
        return `source ${details.join(" ")}`
    }

    private static compareMemories(a: MemoryRecord, b: MemoryRecord) {
        const approved = Number(b.userApproved) - Number(a.userApproved)
        if (approved !== 0) {
            return approved
        }
        const confidence = b.confidence - a.confidence
        if (confidence !== 0) {
            return confidence
        }
        return b.updatedAt.localeCompare(a.updatedAt)
    }

    private static conflictRules() {
        return [
            "Do not automatically merge conflicting memories.",
            "When memories conflict, prefer user-approved memory, then newer sourced memory, then the more specific scope, then higher confidence.",
            "If the conflict affects durable memory, keep both records visible and propose a supersession instead of overwriting active facts.",
        ].join("\n")
    }

    private static section(title: string, content: string): ContextSection {
        return {title, content}
    }

    private static render(sections: ContextSection[]) {
        return sections.map((section) => [
            `## ${section.title}`,
            section.content,
        ].join("\n")).join("\n\n")
    }
}
