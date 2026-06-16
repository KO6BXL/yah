import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileStore } from "./fileStore.ts";

export const DEFAULT_SESSION_ID = "default";

export class SessionStore {
    public static normalize(sessionId: string) {
        const normalized = sessionId.trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(normalized)) {
            throw new Error("Session names may only use letters, numbers, dashes, and underscores.");
        }
        return normalized;
    }

    public static async getPath(sessionId: string) {
        const normalized = SessionStore.normalize(sessionId);
        const dir = path.join(FileStore.GetDataDir(), "session");
        await mkdir(dir, {recursive: true});
        return path.join(dir, `${normalized}.jsonl`);
    }

    public static async list() {
        const dir = path.join(FileStore.GetDataDir(), "session");
        try {
            const files = await readdir(dir);
            return files
                .filter((file) => file.endsWith(".jsonl"))
                .map((file) => file.slice(0, -".jsonl".length))
                .filter((sessionId) => {
                    try {
                        SessionStore.normalize(sessionId);
                        return true;
                    } catch {
                        return false;
                    }
                })
                .sort();
        } catch {
            return [];
        }
    }

    public static async delete(sessionId: string) {
        const sessionPath = await SessionStore.getPath(sessionId);
        await rm(sessionPath, {force: true});
    }
}
