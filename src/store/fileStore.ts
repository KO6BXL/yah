import { SecretStore } from "./secretStore.ts";
import path from "node:path"
import { mkdir, open, readFile, stat} from "node:fs/promises"



export class FileStore {
    public static async GetDataDir() {
        let dataDir = ""
        const canidate1 = SecretStore.get("DATA_DIR")
        const canidate2 = SecretStore.get("HOME")
        if (canidate1) {
            dataDir = canidate1
        } else if (canidate2) {
            dataDir = path.join(canidate2, ".local/share/yah/")
        } else {
            throw new Error("Cannot determine a safe place to put yah files")
        }

        const datadirdir = await stat(dataDir)
        if (!datadirdir.isDirectory()){
            await mkdir(dataDir)
        }
        return dataDir
    }

    public static async Read(relativeFilepath: string) {
        try {
            const fullPath = path.join(await FileStore.GetDataDir(), relativeFilepath)
            const fd = await open(fullPath)
            const contents = await readFile(fd)
            return contents
        } catch(e) {
            throw e
        }
    }

    public static async Write(relativeFilepath: string, buffer: string | Uint8Array) {
        try {
            const fullPath = path.join(await FileStore.GetDataDir(), relativeFilepath)
            const fd = await open(fullPath)
            if (typeof buffer === "string") {
                buffer = Buffer.from(buffer)
            }
            await fd.write(buffer)
        } catch(e) {
            throw e
        }
    }

    public static async Exists(relativeFilepath: string) {
        try {
            const fullPath = path.join(await FileStore.GetDataDir(), relativeFilepath)
            const stats = await stat(fullPath)
            return stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()
        } catch(e) {
            throw e
        }
    }

    public static async GetFullPath(relativeFilepath: string) {
        return path.join(await FileStore.GetDataDir(), relativeFilepath)
    }
}