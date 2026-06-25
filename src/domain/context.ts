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

export type MemoryKind =
    | "task"
    | "working"
    | "semantic"
    | "episodic"
    | "procedural"
    | "artifact"

export type MemoryStatus =
    | "active"
    | "proposed"
    | "superseded"
    | "archived"
    | "deleted"

export type MemoryVisibility = "private" | "channel" | "category"

export type MemorySourceKind = "user" | "agent" | "janitor" | "import"

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

export type MemoryRecord = {
    id: string
    scope: MemoryScope
    nodeId: CategoryId | ChannelId | ThreadId
    kind: MemoryKind
    status: MemoryStatus
    content: string
    tags: string[]
    confidence: number
    agentWritable: boolean
    userApproved: boolean
    visibility: MemoryVisibility
    source: {
        discordGuildId?: DiscordGuildId
        discordChannelId?: DiscordChannelId
        discordThreadId?: DiscordThreadId
        discordMessageId?: DiscordMessageId
        toolCallId?: string
        createdBy: MemorySourceKind
    }
    validFrom?: string
    validUntil?: string
    supersedes?: string[]
    supersededBy?: string
    approvedByUserId?: string
    approvedAt?: string
    createdAt: string
    updatedAt: string
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
