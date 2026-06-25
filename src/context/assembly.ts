import {
    toDiscordThreadId,
    type Category,
    type Channel,
    type Thread,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";

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

        const sections = [
            ContextAssembly.section("Base System Instructions", baseSystemInstructions),
            ContextAssembly.section("Category Task and Procedural Context", ContextAssembly.categoryContext(category)),
            ContextAssembly.section("Channel Task and Working Context", ContextAssembly.nodeContext(channel)),
            ContextAssembly.section("Thread Live Context", ContextAssembly.threadContext(thread)),
            ContextAssembly.section("Durable Memory", "Durable memory retrieval is not implemented yet."),
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
