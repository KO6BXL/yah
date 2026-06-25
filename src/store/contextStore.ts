import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
    type Category,
    type CategoryId,
    type Channel,
    type ChannelId,
    type ContextNode,
    type ContextNodeKind,
    type Thread,
    type ThreadId,
} from "../domain/context.ts";
import { FileStore } from "./fileStore.ts";

type ContextNodeByKind = {
    category: Category
    channel: Channel
    thread: Thread
}

const contextDirs: Record<ContextNodeKind, string> = {
    category: "categories",
    channel: "channels",
    thread: "threads",
};

export class ContextStore {
    public static async writeCategory(category: Category) {
        await ContextStore.writeNode(category);
    }

    public static async writeChannel(channel: Channel) {
        await ContextStore.writeNode(channel);
    }

    public static async writeThread(thread: Thread) {
        await ContextStore.writeNode(thread);
    }

    public static async readCategory(id: CategoryId) {
        return ContextStore.readNode("category", id);
    }

    public static async readChannel(id: ChannelId) {
        return ContextStore.readNode("channel", id);
    }

    public static async readThread(id: ThreadId) {
        return ContextStore.readNode("thread", id);
    }

    public static async listCategories() {
        return ContextStore.listNodes("category");
    }

    public static async listChannels(categoryId?: CategoryId) {
        const channels = await ContextStore.listNodes("channel");
        if (!categoryId) {
            return channels;
        }
        return channels.filter((channel) => channel.parentCategoryId === categoryId);
    }

    public static async listThreads(channelId?: ChannelId) {
        const threads = await ContextStore.listNodes("thread");
        if (!channelId) {
            return threads;
        }
        return threads.filter((thread) => thread.parentChannelId === channelId);
    }

    public static async listCategoryThreads(categoryId: CategoryId) {
        const threads = await ContextStore.listNodes("thread");
        return threads.filter((thread) => thread.parentCategoryId === categoryId);
    }

    private static async writeNode(node: ContextNode) {
        const filePath = await ContextStore.nodePath(node.kind, node.id);
        await writeFile(filePath, `${JSON.stringify(node, null, 2)}\n`);
    }

    private static async readNode<K extends ContextNodeKind>(kind: K, id: ContextNodeByKind[K]["id"]) {
        try {
            const filePath = await ContextStore.nodePath(kind, id);
            const text = await readFile(filePath, "utf8");
            return JSON.parse(text) as ContextNodeByKind[K];
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }

    private static async listNodes<K extends ContextNodeKind>(kind: K) {
        const dir = await ContextStore.nodeDir(kind);
        const files = await readdir(dir, {withFileTypes: true});
        const nodes = await Promise.all(files
            .filter((file) => file.isFile() && file.name.endsWith(".json"))
            .map(async (file) => {
                const text = await readFile(path.join(dir, file.name), "utf8");
                return JSON.parse(text) as ContextNodeByKind[K];
            }));
        return nodes;
    }

    private static async nodePath(kind: ContextNodeKind, id: string) {
        const dir = await ContextStore.nodeDir(kind);
        return path.join(dir, `${ContextStore.fileNameForId(id)}.json`);
    }

    private static async nodeDir(kind: ContextNodeKind) {
        const dir = path.join(FileStore.GetDataDir(), "context", contextDirs[kind]);
        await mkdir(dir, {recursive: true});
        return dir;
    }

    private static fileNameForId(id: string) {
        if (!/^\d{1,32}$/.test(id)) {
            throw new Error("Context IDs must be Discord snowflake IDs.");
        }
        return id;
    }
}
