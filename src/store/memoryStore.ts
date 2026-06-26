import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    assertMemoryRecord,
    type CategoryId,
    type ChannelId,
    type ContextNode,
    type MemoryKind,
    type MemoryRecord,
    type MemoryScope,
    type MemoryStatus,
    type ThreadId,
} from "../domain/context.ts";
import { ContextStore } from "./contextStore.ts";
import { FileStore } from "./fileStore.ts";

export type MemoryRecordInput = Omit<MemoryRecord, "id" | "createdAt" | "updatedAt"> & {
    id?: string
    createdAt?: string
    updatedAt?: string
}

export type MemoryRecordUpdate = Partial<Omit<MemoryRecord, "id" | "scope" | "nodeId" | "createdAt">>

export type MemoryListFilter = {
    scope?: MemoryScope
    nodeId?: string
    kind?: MemoryKind
    status?: MemoryStatus
    text?: string
}

export type MemoryAuditAction = "create" | "update" | "archive" | "restore" | "move" | "supersede" | "mark-deleted" | "approve" | "reject"

export type MemoryAuditEvent = {
    id: string
    memoryId: string
    action: MemoryAuditAction
    actor?: string
    note?: string
    createdAt: string
}

export type MemoryApprovalActor = {
    userId: string
    roleIds?: string[]
}

export class MemoryStore {
    public static async create(input: MemoryRecordInput, actor?: string) {
        const now = new Date().toISOString();
        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...input,
            id: input.id ?? randomUUID(),
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        } as MemoryRecord));
        await MemoryStore.writeRecord(record, "create", actor);
        return record;
    }

    public static async update(id: string, update: MemoryRecordUpdate, actor?: string) {
        const existing = await MemoryStore.read(id);
        if (!existing) {
            throw new Error(`Memory record ${id} was not found.`);
        }
        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...existing,
            ...update,
            id: existing.id,
            scope: existing.scope,
            nodeId: existing.nodeId,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        } as MemoryRecord), existing);
        await MemoryStore.writeRecord(record, "update", actor);
        return record;
    }

    public static async archive(id: string, actor?: string) {
        const existing = await MemoryStore.readRequired(id);
        const record = assertMemoryRecord({
            ...existing,
            status: "archived",
            updatedAt: new Date().toISOString(),
        } as MemoryRecord);
        await MemoryStore.writeRecord(record, "archive", actor);
        return record;
    }

    public static async restore(id: string, actor?: string) {
        const existing = await MemoryStore.readRequired(id);
        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...existing,
            status: "active",
            updatedAt: new Date().toISOString(),
        } as MemoryRecord), existing);
        await MemoryStore.writeRecord(record, "restore", actor);
        return record;
    }

    public static async move(id: string, scope: MemoryScope, nodeId: string, actor?: string) {
        const existing = await MemoryStore.readRequired(id);
        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...existing,
            scope,
            nodeId,
            updatedAt: new Date().toISOString(),
        } as MemoryRecord), existing);
        await MemoryStore.writeRecord(record, "move", actor, `Moved from ${existing.scope}:${existing.nodeId} to ${scope}:${nodeId}`);
        return record;
    }

    public static async approve(id: string, actor: MemoryApprovalActor, update: MemoryRecordUpdate = {}) {
        const existing = await MemoryStore.readRequired(id);
        if (existing.status !== "proposed") {
            throw new Error("Only proposed memory can be approved.");
        }
        await MemoryStore.assertCanApprove(existing, actor);

        const approvedAt = new Date().toISOString();
        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...existing,
            ...update,
            id: existing.id,
            scope: existing.scope,
            nodeId: existing.nodeId,
            status: "active",
            userApproved: true,
            approvedByUserId: actor.userId,
            approvedAt,
            createdAt: existing.createdAt,
            updatedAt: approvedAt,
        } as MemoryRecord), existing);
        await MemoryStore.writeRecord(record, "approve", actor.userId);
        return record;
    }

    public static async reject(id: string, actor: MemoryApprovalActor) {
        const existing = await MemoryStore.readRequired(id);
        if (existing.status !== "proposed") {
            throw new Error("Only proposed memory can be rejected.");
        }
        await MemoryStore.assertCanApprove(existing, actor);

        const record = assertMemoryRecord({
            ...existing,
            status: "archived",
            updatedAt: new Date().toISOString(),
        } as MemoryRecord);
        await MemoryStore.writeRecord(record, "reject", actor.userId);
        return record;
    }

    public static async moveProposalToLowerScope(id: string, scope: MemoryScope, nodeId: string, actor: MemoryApprovalActor) {
        const existing = await MemoryStore.readRequired(id);
        if (existing.status !== "proposed") {
            throw new Error("Only proposed memory can be moved during approval.");
        }
        if (!MemoryStore.isLowerScope(existing.scope, scope)) {
            throw new Error("Approval proposals can only be moved to a lower scope.");
        }
        await MemoryStore.assertCanApprove(existing, actor);

        const record = MemoryStore.applyWriteRules(assertMemoryRecord({
            ...existing,
            scope,
            nodeId,
            updatedAt: new Date().toISOString(),
        } as MemoryRecord), existing);
        await MemoryStore.writeRecord(record, "move", actor.userId, `Moved proposal from ${existing.scope}:${existing.nodeId} to ${scope}:${nodeId}`);
        return record;
    }

    public static async supersede(id: string, replacement: MemoryRecordInput, actor?: string) {
        const existing = await MemoryStore.readRequired(id);
        const replacementRecord = await MemoryStore.create({
            ...replacement,
            supersedes: [...(replacement.supersedes ?? []), existing.id],
        }, actor);

        const superseded = assertMemoryRecord({
            ...existing,
            status: "superseded",
            supersededBy: replacementRecord.id,
            updatedAt: new Date().toISOString(),
        } as MemoryRecord);
        await MemoryStore.writeRecord(superseded, "supersede", actor, `Superseded by ${replacementRecord.id}`);
        return {superseded, replacement: replacementRecord};
    }

    public static async markDeleted(id: string, deletedByUserId: string) {
        const existing = await MemoryStore.readRequired(id);
        const record = assertMemoryRecord({
            ...existing,
            status: "deleted",
            updatedAt: new Date().toISOString(),
        } as MemoryRecord);
        await MemoryStore.writeRecord(record, "mark-deleted", deletedByUserId);
        return record;
    }

    public static async read(id: string) {
        try {
            const filePath = await MemoryStore.recordPath(id);
            const text = await readFile(filePath, "utf8");
            return assertMemoryRecord(JSON.parse(text) as MemoryRecord);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }

    public static async list(filter: MemoryListFilter = {}) {
        const dir = await MemoryStore.recordsDir();
        const files = await readdir(dir, {withFileTypes: true});
        const records = await Promise.all(files
            .filter((file) => file.isFile() && file.name.endsWith(".json"))
            .map(async (file) => {
                const text = await readFile(path.join(dir, file.name), "utf8");
                return assertMemoryRecord(JSON.parse(text) as MemoryRecord);
            }));

        return records.filter((record) => MemoryStore.matchesFilter(record, filter));
    }

    public static async listAuditEvents() {
        try {
            const text = await readFile(await MemoryStore.auditPath(), "utf8");
            return text
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line) as MemoryAuditEvent);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                return [];
            }
            throw error;
        }
    }

    private static async readRequired(id: string) {
        const record = await MemoryStore.read(id);
        if (!record) {
            throw new Error(`Memory record ${id} was not found.`);
        }
        return record;
    }

    private static applyWriteRules(record: MemoryRecord, existing?: MemoryRecord) {
        if (MemoryStore.isAgentCreated(record)) {
            if (record.scope === "category" && record.status !== "proposed" && !record.userApproved) {
                throw new Error("Agent-created category memory must be proposed for user approval.");
            }

            if (MemoryStore.requiresUserOwnedProposal(record) && record.status !== "proposed" && !record.userApproved) {
                throw new Error("Agent-created task and procedural memory changes must be proposed for user approval.");
            }

            if (MemoryStore.isDurableChannelMemory(record) && !record.userApproved) {
                record = {
                    ...record,
                    agentWritable: false,
                    tags: MemoryStore.withTag(record.tags, "agent-created"),
                } as MemoryRecord;
            }
        }

        if (existing && MemoryStore.isAgentCreated(record) && MemoryStore.isSilentDurableOverwrite(existing, record)) {
            throw new Error("Active durable memory cannot be silently overwritten. Supersede it or create a proposal.");
        }

        return assertMemoryRecord(record);
    }

    private static isAgentCreated(record: MemoryRecord) {
        return record.source.createdBy === "agent" || record.source.createdBy === "janitor";
    }

    private static requiresUserOwnedProposal(record: MemoryRecord) {
        return record.kind === "task" || record.kind === "procedural";
    }

    private static isDurableChannelMemory(record: MemoryRecord) {
        return record.scope === "channel" && record.kind !== "working";
    }

    private static isDurableMemory(record: MemoryRecord) {
        return record.kind !== "working";
    }

    private static isSilentDurableOverwrite(existing: MemoryRecord, next: MemoryRecord) {
        if (!MemoryStore.isDurableMemory(existing) || existing.status !== "active") {
            return false;
        }
        if (next.status === "proposed" || next.status === "superseded" || next.status === "archived" || next.status === "deleted") {
            return false;
        }
        return existing.content !== next.content;
    }

    private static isLowerScope(from: MemoryScope, to: MemoryScope) {
        const ranks: Record<MemoryScope, number> = {
            category: 0,
            channel: 1,
            thread: 2,
        }
        return ranks[to] > ranks[from]
    }

    private static async assertCanApprove(record: MemoryRecord, actor: MemoryApprovalActor) {
        const node = await MemoryStore.approvalNode(record);
        const permissions = node.permissions;
        const roleIds = actor.roleIds ?? [];
        if (permissions.ownerUserIds.includes(actor.userId)) {
            return;
        }
        if (roleIds.some((roleId) => permissions.approvedRoleIds.includes(roleId))) {
            return;
        }
        throw new Error(`User ${actor.userId} is not allowed to approve ${record.scope} memory.`);
    }

    private static async approvalNode(record: MemoryRecord): Promise<ContextNode> {
        const node = await MemoryStore.contextNode(record.scope, record.nodeId);
        if (node.permissions.approvalPolicy === "owner") {
            return node;
        }
        if (node.permissions.approvalPolicy === "category-owner") {
            if (node.kind === "category") {
                return node;
            }
            const category = await ContextStore.readCategory(node.parentCategoryId);
            if (!category) {
                throw new Error(`Category ${node.parentCategoryId} was not found for approval.`);
            }
            return category;
        }
        if (node.permissions.approvalPolicy === "channel-owner") {
            if (node.kind === "channel") {
                return node;
            }
            if (node.kind === "thread") {
                const channel = await ContextStore.readChannel(node.parentChannelId);
                if (!channel) {
                    throw new Error(`Channel ${node.parentChannelId} was not found for approval.`);
                }
                return channel;
            }
            return node;
        }
        return node;
    }

    private static async contextNode(scope: MemoryScope, nodeId: string): Promise<ContextNode> {
        if (scope === "category") {
            const node = await ContextStore.readCategory(nodeId as CategoryId);
            if (node) {
                return node;
            }
        }
        if (scope === "channel") {
            const node = await ContextStore.readChannel(nodeId as ChannelId);
            if (node) {
                return node;
            }
        }
        if (scope === "thread") {
            const node = await ContextStore.readThread(nodeId as ThreadId);
            if (node) {
                return node;
            }
        }
        throw new Error(`${scope} context node ${nodeId} was not found.`);
    }

    private static withTag(tags: string[], tag: string) {
        return tags.includes(tag) ? tags : [...tags, tag];
    }

    private static async writeRecord(record: MemoryRecord, action: MemoryAuditAction, actor?: string, note?: string) {
        await writeFile(await MemoryStore.recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
        await MemoryStore.writeAudit({
            id: randomUUID(),
            memoryId: record.id,
            action,
            actor,
            note,
            createdAt: new Date().toISOString(),
        });
    }

    private static async writeAudit(event: MemoryAuditEvent) {
        await appendFile(await MemoryStore.auditPath(), `${JSON.stringify(event)}\n`);
    }

    private static matchesFilter(record: MemoryRecord, filter: MemoryListFilter) {
        if (filter.scope && record.scope !== filter.scope) {
            return false;
        }
        if (filter.nodeId && record.nodeId !== filter.nodeId) {
            return false;
        }
        if (filter.kind && record.kind !== filter.kind) {
            return false;
        }
        if (filter.status && record.status !== filter.status) {
            return false;
        }
        if (filter.text) {
            const text = filter.text.toLowerCase();
            const haystack = [record.content, ...record.tags].join("\n").toLowerCase();
            return haystack.includes(text);
        }
        return true;
    }

    private static async recordPath(id: string) {
        const dir = await MemoryStore.recordsDir();
        return path.join(dir, `${MemoryStore.fileNameForId(id)}.json`);
    }

    private static async recordsDir() {
        const dir = path.join(FileStore.GetDataDir(), "memory", "records");
        await mkdir(dir, {recursive: true});
        return dir;
    }

    private static async auditPath() {
        const dir = path.join(FileStore.GetDataDir(), "memory");
        await mkdir(dir, {recursive: true});
        return path.join(dir, "audit.jsonl");
    }

    private static fileNameForId(id: string) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
            throw new Error("Memory IDs may only use letters, numbers, dashes, and underscores.");
        }
        return id;
    }
}
