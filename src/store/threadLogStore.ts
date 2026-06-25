import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileStore } from "./fileStore.ts";
import { toDiscordThreadId, type DiscordMessageId, type ThreadId } from "../domain/context.ts";

export type ThreadLogRole = "user" | "assistant" | "system"

export type ThreadLogEntry = {
    id: string
    threadId: ThreadId
    role: ThreadLogRole
    content: string
    discordMessageId?: DiscordMessageId
    createdAt: string
}

export type ThreadLogEntryInput = Omit<ThreadLogEntry, "id" | "createdAt"> & {
    id?: string
    createdAt?: string
}

export class ThreadLogStore {
    public static async append(input: ThreadLogEntryInput) {
        const entry: ThreadLogEntry = {
            ...input,
            id: input.id ?? randomUUID(),
            threadId: toDiscordThreadId(input.threadId),
            createdAt: input.createdAt ?? new Date().toISOString(),
        }
        await appendFile(await ThreadLogStore.threadPath(entry.threadId), `${JSON.stringify(entry)}\n`);
        return entry
    }

    public static async list(threadId: string) {
        try {
            const text = await readFile(await ThreadLogStore.threadPath(toDiscordThreadId(threadId)), "utf8");
            return text
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line) as ThreadLogEntry)
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                return []
            }
            throw error
        }
    }

    public static async listThreadIds() {
        const dir = await ThreadLogStore.logsDir();
        const files = await readdir(dir, {withFileTypes: true});
        return files
            .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
            .map((file) => toDiscordThreadId(file.name.slice(0, -".jsonl".length)))
    }

    private static async threadPath(threadId: ThreadId) {
        const dir = await ThreadLogStore.logsDir();
        return path.join(dir, `${ThreadLogStore.fileNameForId(threadId)}.jsonl`);
    }

    private static async logsDir() {
        const dir = path.join(FileStore.GetDataDir(), "thread-logs");
        await mkdir(dir, {recursive: true});
        return dir;
    }

    private static fileNameForId(id: string) {
        if (!/^\d{1,32}$/.test(id)) {
            throw new Error("Thread log IDs must be Discord snowflake IDs.");
        }
        return id;
    }
}
