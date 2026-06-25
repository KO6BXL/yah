import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    assertMemoryRecord,
    type MemoryKind,
    type MemoryRecord,
    type MemoryScope,
    type MemoryStatus,
} from "../domain/context.ts";
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

export type MemoryAuditAction = "create" | "update" | "archive" | "supersede" | "mark-deleted"

export type MemoryAuditEvent = {
    id: string
    memoryId: string
    action: MemoryAuditAction
    actor?: string
    note?: string
    createdAt: string
}

export class MemoryStore {
    public static async create(input: MemoryRecordInput, actor?: string) {
        const now = new Date().toISOString();
        const record = assertMemoryRecord({
            ...input,
            id: input.id ?? randomUUID(),
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        } as MemoryRecord);
        await MemoryStore.writeRecord(record, "create", actor);
        return record;
    }

    public static async update(id: string, update: MemoryRecordUpdate, actor?: string) {
        const existing = await MemoryStore.read(id);
        if (!existing) {
            throw new Error(`Memory record ${id} was not found.`);
        }
        const record = assertMemoryRecord({
            ...existing,
            ...update,
            id: existing.id,
            scope: existing.scope,
            nodeId: existing.nodeId,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        } as MemoryRecord);
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

    private static async readRequired(id: string) {
        const record = await MemoryStore.read(id);
        if (!record) {
            throw new Error(`Memory record ${id} was not found.`);
        }
        return record;
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
