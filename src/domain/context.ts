type Brand<T, Name extends string> = T & {readonly __brand: Name}

export type DiscordGuildId = Brand<string, "DiscordGuildId">
export type DiscordCategoryId = Brand<string, "DiscordCategoryId">
export type DiscordChannelId = Brand<string, "DiscordChannelId">
export type DiscordThreadId = Brand<string, "DiscordThreadId">
export type DiscordMessageId = Brand<string, "DiscordMessageId">

export type CategoryId = DiscordCategoryId
export type ChannelId = DiscordChannelId
export type ThreadId = DiscordThreadId
export type MessageId = DiscordMessageId

export type ContextNodeKind = "category" | "channel" | "thread"

export type MemoryScope = ContextNodeKind

export const memoryScopes = ["category", "channel", "thread"] as const

export type MemoryKind =
    | "task"
    | "working"
    | "semantic"
    | "episodic"
    | "procedural"
    | "artifact"

export const memoryKinds = [
    "task",
    "working",
    "semantic",
    "episodic",
    "procedural",
    "artifact",
] as const

export type MemoryStatus =
    | "active"
    | "proposed"
    | "superseded"
    | "archived"
    | "deleted"

export const memoryStatuses = [
    "active",
    "proposed",
    "superseded",
    "archived",
    "deleted",
] as const

export type MemoryVisibility = "private" | "channel" | "category"

export type MemorySourceKind = "user" | "agent" | "janitor" | "import"

export type MemorySource = {
    discordGuildId?: DiscordGuildId
    discordChannelId?: DiscordChannelId
    discordThreadId?: DiscordThreadId
    discordMessageId?: DiscordMessageId
    toolCallId?: string
    toolName?: string
    toolProvider?: string
    createdBy: MemorySourceKind
}

export type ApprovalPolicy = "owner" | "category-owner" | "channel-owner"

export type ContextPermissions = {
    ownerUserIds: string[]
    approvedRoleIds: string[]
    approvalPolicy: ApprovalPolicy
}

export type ContextNodeBase = {
    guildId: DiscordGuildId
    name: string
    createdAt: string
    updatedAt: string
    taskMemory?: string
    workingMemory?: string
    permissions: ContextPermissions
}

export type Category = ContextNodeBase & {
    kind: "category"
    id: CategoryId
}

export type Channel = ContextNodeBase & {
    kind: "channel"
    id: ChannelId
    parentCategoryId: CategoryId
}

export type Thread = ContextNodeBase & {
    kind: "thread"
    id: ThreadId
    parentCategoryId: CategoryId
    parentChannelId: ChannelId
    startedByUserId: string
    sourceMessageId?: MessageId
    completedAt?: string
}

export type ContextNode = Category | Channel | Thread

export type MemoryRecordBase = {
    id: string
    kind: MemoryKind
    status: MemoryStatus
    content: string
    tags: string[]
    confidence: number
    agentWritable: boolean
    userApproved: boolean
    visibility: MemoryVisibility
    source: MemorySource
    validFrom?: string
    validUntil?: string
    supersedes?: string[]
    supersededBy?: string
    approvedByUserId?: string
    approvedAt?: string
    createdAt: string
    updatedAt: string
}

export type CategoryMemoryRecord = MemoryRecordBase & {
    scope: "category"
    nodeId: CategoryId
}

export type ChannelMemoryRecord = MemoryRecordBase & {
    scope: "channel"
    nodeId: ChannelId
}

export type ThreadMemoryRecord = MemoryRecordBase & {
    scope: "thread"
    nodeId: ThreadId
}

export type MemoryRecord = CategoryMemoryRecord | ChannelMemoryRecord | ThreadMemoryRecord

export function assertMemoryRecord(record: MemoryRecord): MemoryRecord {
    validateString(record.id, "Memory record ID")
    validateEnum(record.scope, memoryScopes, "Memory scope")
    validateEnum(record.kind, memoryKinds, "Memory kind")
    validateEnum(record.status, memoryStatuses, "Memory status")
    validateString(record.nodeId, "Memory node ID")
    validateString(record.content, "Memory content")
    validateString(record.createdAt, "Memory createdAt")
    validateString(record.updatedAt, "Memory updatedAt")

    if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
        throw new Error("Memory confidence must be a number between 0 and 1.")
    }
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string")) {
        throw new Error("Memory tags must be an array of strings.")
    }
    if (record.supersedes && record.supersedes.some((id) => typeof id !== "string" || id.length === 0)) {
        throw new Error("Memory supersedes links must be non-empty strings.")
    }
    if (record.supersededBy !== undefined) {
        validateString(record.supersededBy, "Memory supersededBy")
    }
    if (record.approvedByUserId !== undefined) {
        validateString(record.approvedByUserId, "Memory approvedByUserId")
    }
    if (record.approvedAt !== undefined) {
        validateString(record.approvedAt, "Memory approvedAt")
    }
    validateMemorySource(record.source)
    return record
}

function validateMemorySource(source: MemorySource) {
    if (!source || typeof source !== "object") {
        throw new Error("Memory source is required.")
    }
    validateEnum(source.createdBy, ["user", "agent", "janitor", "import"] as const, "Memory source createdBy")
    if (source.toolCallId !== undefined) {
        validateString(source.toolCallId, "Memory source toolCallId")
    }
    if (source.toolName !== undefined) {
        validateString(source.toolName, "Memory source toolName")
    }
    if (source.toolProvider !== undefined) {
        validateString(source.toolProvider, "Memory source toolProvider")
    }
}

export function toDiscordGuildId(id: string): DiscordGuildId {
    return normalizeDiscordId(id, "guild") as DiscordGuildId
}

export function toDiscordCategoryId(id: string): DiscordCategoryId {
    return normalizeDiscordId(id, "category") as DiscordCategoryId
}

export function toDiscordChannelId(id: string): DiscordChannelId {
    return normalizeDiscordId(id, "channel") as DiscordChannelId
}

export function toDiscordThreadId(id: string): DiscordThreadId {
    return normalizeDiscordId(id, "thread") as DiscordThreadId
}

export function toDiscordMessageId(id: string): DiscordMessageId {
    return normalizeDiscordId(id, "message") as DiscordMessageId
}

function normalizeDiscordId(id: string, label: string): string {
    const normalized = id.trim()
    if (!/^\d{1,32}$/.test(normalized)) {
        throw new Error(`Invalid Discord ${label} ID.`)
    }
    return normalized
}

function validateString(value: string, label: string) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} must be a non-empty string.`)
    }
}

function validateEnum<T extends readonly string[]>(value: string, allowed: T, label: string) {
    if (!allowed.includes(value)) {
        throw new Error(`${label} must be one of: ${allowed.join(", ")}.`)
    }
}
