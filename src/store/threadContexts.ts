import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FileStore } from "./fileStore.ts";

export class ThreadContextStore {
    public static normalize(threadId: string) {
        const normalized = threadId.trim();
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
            throw new Error("Thread context IDs may only use letters, numbers, dashes, and underscores.");
        }
        return normalized;
    }

    public static async getPath(threadId: string) {
        const normalized = ThreadContextStore.normalize(threadId);
        const dir = path.join(FileStore.GetDataDir(), "threads");
        await mkdir(dir, {recursive: true});
        return path.join(dir, `${normalized}.jsonl`);
    }
}
