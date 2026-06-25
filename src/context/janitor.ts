import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    type Channel,
    type ChannelId,
    type MemoryKind,
    type MemoryRecord,
    type MemoryScope,
    type Thread,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { FileStore } from "../store/fileStore.ts";
import { MemoryStore, type MemoryRecordInput } from "../store/memoryStore.ts";
import { ThreadLogStore, type ThreadLogEntry } from "../store/threadLogStore.ts";

const defaultJanitorIntervalMs = 3 * 24 * 60 * 60 * 1000

type JanitorRunState = {
    channelId: ChannelId
    lastStartedAt: string
    lastFinishedAt: string
    lastStatus: "completed" | "skipped"
}

export type JanitorRunResult = {
    channel: Channel
    skipped: boolean
    since: string
    archived: MemoryRecord[]
    summaries: MemoryRecord[]
    candidates: MemoryRecord[]
    duplicateCandidatesSkipped: number
    digest?: MemoryRecord
}

type CandidateInput = {
    scope: MemoryScope
    nodeId: MemoryRecordInput["nodeId"]
    kind: MemoryKind
    content: string
    tags: string[]
    source: MemoryRecordInput["source"]
}

export class Janitor {
    public static defaultIntervalMs = defaultJanitorIntervalMs

    public static async runAllChannels(options: {intervalMs?: number} = {}) {
        const channels = await ContextStore.listChannels()
        const results: JanitorRunResult[] = []
        for (const channel of channels) {
            results.push(await Janitor.runChannel(channel.id, options))
        }
        return results
    }

    public static async runChannel(channelId: ChannelId, options: {intervalMs?: number} = {}): Promise<JanitorRunResult> {
        const channel = await ContextStore.readChannel(channelId)
        if (!channel) {
            throw new Error(`Channel ${channelId} is not registered in context storage.`)
        }

        const startedAt = new Date()
        const previous = await Janitor.readRunState(channelId)
        const intervalMs = options.intervalMs ?? Janitor.defaultIntervalMs
        const since = previous?.lastFinishedAt ?? new Date(startedAt.getTime() - intervalMs).toISOString()
        const threads = await ContextStore.listThreads(channel.id)
        const activity = await Janitor.channelActivity(threads, since)

        if (!activity.hasRelevantActivity) {
            await Janitor.writeRunState({
                channelId: channel.id,
                lastStartedAt: startedAt.toISOString(),
                lastFinishedAt: new Date().toISOString(),
                lastStatus: "skipped",
            })
            return {
                channel,
                skipped: true,
                since,
                archived: [],
                summaries: [],
                candidates: [],
                duplicateCandidatesSkipped: 0,
            }
        }

        const completedThreads = threads.filter((thread) => thread.completedAt)
        const archived = await Janitor.archiveStaleWorkingMemory(channel, completedThreads, startedAt)
        const summaries = await Janitor.summarizeCompletedThreads(completedThreads)
        const candidateResult = await Janitor.extractCandidates(channel, completedThreads, activity.logs)
        const digest = await Janitor.writeDigest(channel, {
            since,
            archived,
            summaries,
            candidates: candidateResult.created,
            duplicateCandidatesSkipped: candidateResult.duplicateCandidatesSkipped,
        })

        await Janitor.writeRunState({
            channelId: channel.id,
            lastStartedAt: startedAt.toISOString(),
            lastFinishedAt: new Date().toISOString(),
            lastStatus: "completed",
        })

        return {
            channel,
            skipped: false,
            since,
            archived,
            summaries,
            candidates: candidateResult.created,
            duplicateCandidatesSkipped: candidateResult.duplicateCandidatesSkipped,
            digest,
        }
    }

    public static renderDigest(result: JanitorRunResult) {
        if (result.skipped) {
            return `Janitor skipped #${result.channel.name}: no relevant activity since ${result.since}.`
        }
        return result.digest?.content ?? [
            `Janitor completed #${result.channel.name}.`,
            `Archived working memories: ${result.archived.length}`,
            `Completed thread summaries: ${result.summaries.length}`,
            `Memory candidates: ${result.candidates.length}`,
            `Duplicate candidates skipped: ${result.duplicateCandidatesSkipped}`,
        ].join("\n")
    }

    private static async channelActivity(threads: Thread[], since: string) {
        const logsByThread = await Promise.all(threads.map(async (thread) => ({
            thread,
            logs: await ThreadLogStore.list(thread.id),
        })))
        const logs = logsByThread.flatMap((entry) => entry.logs)
        const hasRecentLog = logs.some((entry) => entry.createdAt > since)
        const hasRecentCompletion = threads.some((thread) => thread.completedAt && thread.completedAt > since)
        const hasRelevantActivity = hasRecentLog || hasRecentCompletion
        return {hasRelevantActivity, logs, logsByThread}
    }

    private static async archiveStaleWorkingMemory(channel: Channel, completedThreads: Thread[], now: Date) {
        const completedThreadIds = new Set(completedThreads.map((thread) => thread.id))
        const [channelWorking, threadWorking] = await Promise.all([
            MemoryStore.list({scope: "channel", nodeId: channel.id, kind: "working", status: "active"}),
            MemoryStore.list({kind: "working", status: "active"}),
        ])

        const staleChannelWorking = channelWorking.filter((record) => Janitor.isExpiredOrStale(record, now))
        const staleThreadWorking = threadWorking.filter((record) => (
            record.scope === "thread"
            && completedThreadIds.has(record.nodeId)
        ))
        const stale = [...staleChannelWorking, ...staleThreadWorking]
        return Promise.all(stale.map((record) => MemoryStore.archive(record.id, "janitor")))
    }

    private static isExpiredOrStale(record: MemoryRecord, now: Date) {
        if (record.tags.includes("stale")) {
            return true
        }
        if (!record.validUntil) {
            return false
        }
        return Date.parse(record.validUntil) <= now.getTime()
    }

    private static async summarizeCompletedThreads(threads: Thread[]) {
        const summaries: MemoryRecord[] = []
        for (const thread of threads) {
            const existing = await MemoryStore.list({
                scope: "thread",
                nodeId: thread.id,
                kind: "episodic",
                status: "active",
            })
            if (existing.some((record) => record.tags.includes("thread-completion"))) {
                continue
            }
            const logs = await ThreadLogStore.list(thread.id)
            summaries.push(await MemoryStore.create({
                scope: "thread",
                nodeId: thread.id,
                kind: "episodic",
                status: "active",
                content: Janitor.threadSummary(thread, logs),
                tags: ["thread-completion", "janitor-summary"],
                confidence: 0.65,
                agentWritable: false,
                userApproved: false,
                visibility: "channel",
                source: {
                    createdBy: "janitor",
                    discordGuildId: thread.guildId,
                    discordChannelId: thread.parentChannelId,
                    discordThreadId: thread.id,
                    discordMessageId: thread.sourceMessageId,
                },
            }, "janitor"))
        }
        return summaries
    }

    private static async extractCandidates(channel: Channel, completedThreads: Thread[], logs: ThreadLogEntry[]) {
        const candidates = Janitor.candidateInputs(channel, completedThreads, logs)
        const created: MemoryRecord[] = []
        let duplicateCandidatesSkipped = 0

        for (const candidate of candidates) {
            if (await Janitor.hasDuplicateCandidate(candidate)) {
                duplicateCandidatesSkipped += 1
                continue
            }
            created.push(await MemoryStore.create(Janitor.toMemoryInput(candidate), "janitor"))
        }

        return {created, duplicateCandidatesSkipped}
    }

    private static candidateInputs(channel: Channel, completedThreads: Thread[], logs: ThreadLogEntry[]) {
        const candidates: CandidateInput[] = []
        for (const thread of completedThreads) {
            const source = {
                createdBy: "janitor" as const,
                discordGuildId: thread.guildId,
                discordChannelId: channel.id,
                discordThreadId: thread.id,
                discordMessageId: thread.sourceMessageId,
            }
            candidates.push({
                scope: "channel",
                nodeId: channel.id,
                kind: "episodic",
                content: `Completed thread "${thread.name}" (${thread.id}) should be reviewed for channel memory.`,
                tags: ["janitor-candidate", "completed-thread"],
                source,
            })
            candidates.push({
                scope: "category",
                nodeId: thread.parentCategoryId,
                kind: "episodic",
                content: `Candidate category promotion from channel "${channel.name}": completed thread "${thread.name}" (${thread.id}).`,
                tags: ["janitor-candidate", "category-review", "completed-thread"],
                source,
            })
        }

        for (const log of logs) {
            const text = log.content.trim()
            if (!text) {
                continue
            }
            const source = {
                createdBy: "janitor" as const,
                discordGuildId: channel.guildId,
                discordChannelId: channel.id,
                discordThreadId: log.threadId,
                discordMessageId: log.discordMessageId,
            }
            if (Janitor.looksProcedural(text)) {
                candidates.push({
                    scope: "channel",
                    nodeId: channel.id,
                    kind: "procedural",
                    content: `Candidate workflow rule from thread ${log.threadId}: ${Janitor.truncate(text, 240)}`,
                    tags: ["janitor-candidate", "procedural-review"],
                    source,
                })
            }
            if (Janitor.looksArtifact(text)) {
                candidates.push({
                    scope: "channel",
                    nodeId: channel.id,
                    kind: "artifact",
                    content: `Candidate artifact reference from thread ${log.threadId}: ${Janitor.truncate(text, 240)}`,
                    tags: ["janitor-candidate", "artifact-review"],
                    source,
                })
            }
            if (Janitor.looksSemantic(text)) {
                candidates.push({
                    scope: "channel",
                    nodeId: channel.id,
                    kind: "semantic",
                    content: `Candidate durable fact from thread ${log.threadId}: ${Janitor.truncate(text, 240)}`,
                    tags: ["janitor-candidate", "semantic-review"],
                    source,
                })
            }
        }

        return candidates
    }

    private static async hasDuplicateCandidate(candidate: CandidateInput) {
        const existing = await MemoryStore.list({
            scope: candidate.scope,
            nodeId: candidate.nodeId,
            kind: candidate.kind,
            text: candidate.content,
        })
        return existing.some((record) => (
            record.content === candidate.content
            && record.source.discordThreadId === candidate.source.discordThreadId
            && record.scope === candidate.scope
            && record.nodeId === candidate.nodeId
        ))
    }

    private static toMemoryInput(candidate: CandidateInput): MemoryRecordInput {
        return {
            scope: candidate.scope,
            nodeId: candidate.nodeId,
            kind: candidate.kind,
            status: "proposed",
            content: candidate.content,
            tags: candidate.tags,
            confidence: 0.55,
            agentWritable: false,
            userApproved: false,
            visibility: candidate.scope === "category" ? "category" : "channel",
            source: candidate.source,
        } as MemoryRecordInput
    }

    private static async writeDigest(channel: Channel, summary: {
        since: string
        archived: MemoryRecord[]
        summaries: MemoryRecord[]
        candidates: MemoryRecord[]
        duplicateCandidatesSkipped: number
    }) {
        const content = [
            `Janitor digest for #${channel.name} since ${summary.since}.`,
            `Archived working memories: ${summary.archived.length}.`,
            `Completed thread summaries: ${summary.summaries.length}.`,
            `Memory candidates proposed: ${summary.candidates.length}.`,
            `Duplicate candidates skipped: ${summary.duplicateCandidatesSkipped}.`,
            "No memory was physically deleted.",
        ].join("\n")
        return MemoryStore.create({
            scope: "channel",
            nodeId: channel.id,
            kind: "episodic",
            status: "active",
            content,
            tags: ["janitor-digest"],
            confidence: 0.9,
            agentWritable: false,
            userApproved: false,
            visibility: "channel",
            source: {
                createdBy: "janitor",
                discordGuildId: channel.guildId,
                discordChannelId: channel.id,
            },
        }, "janitor")
    }

    private static threadSummary(thread: Thread, logs: ThreadLogEntry[]) {
        const userMessages = logs.filter((log) => log.role === "user")
        const assistantMessages = logs.filter((log) => log.role === "assistant")
        return [
            `Completed thread "${thread.name}" (${thread.id}).`,
            `Activity: ${userMessages.length} user message(s), ${assistantMessages.length} assistant response(s).`,
            userMessages.at(-1) ? `Last user request: ${Janitor.truncate(userMessages.at(-1)!.content, 280)}` : "Last user request: unavailable.",
            assistantMessages.at(-1) ? `Last assistant response: ${Janitor.truncate(assistantMessages.at(-1)!.content, 280)}` : "Last assistant response: unavailable.",
        ].join("\n")
    }

    private static looksProcedural(text: string) {
        return /\b(always|never|should|when|workflow|process|procedure)\b/i.test(text)
    }

    private static looksArtifact(text: string) {
        return /(https?:\/\/\S+|(?:^|\s)(?:\.{0,2}\/|~\/|\/)[^\s]+)/.test(text)
    }

    private static looksSemantic(text: string) {
        return /\b(is|are|prefers|uses|works in|lives in)\b/i.test(text)
    }

    private static truncate(text: string, limit: number) {
        const normalized = text.replace(/\s+/g, " ").trim()
        if (normalized.length <= limit) {
            return normalized
        }
        return `${normalized.slice(0, limit - 3)}...`
    }

    private static async readRunState(channelId: ChannelId) {
        try {
            const text = await readFile(await Janitor.runStatePath(channelId), "utf8")
            return JSON.parse(text) as JanitorRunState
        } catch (error) {
            const err = error as NodeJS.ErrnoException
            if (err.code === "ENOENT") {
                return undefined
            }
            throw error
        }
    }

    private static async writeRunState(state: JanitorRunState) {
        const filePath = await Janitor.runStatePath(state.channelId)
        await mkdir(path.dirname(filePath), {recursive: true})
        await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`)
    }

    private static async runStatePath(channelId: ChannelId) {
        return path.join(await FileStore.GetFullPath("janitor/channels"), `${Janitor.fileNameForId(channelId)}.json`)
    }

    private static fileNameForId(id: string) {
        if (!/^\d{1,32}$/.test(id)) {
            throw new Error("Janitor channel IDs must be Discord snowflake IDs.")
        }
        return id
    }
}
