import { SecretStore } from "./secretStore.ts";
import path from "node:path"
import { mkdir, readFile, stat, writeFile} from "node:fs/promises"



export class FileStore {
    public static GetDataDir() {
        let dataDir = ""
        const candidate1 = SecretStore.get("DATA_DIR")
        const candidate2 = SecretStore.get("HOME")
        if (candidate1) {
            dataDir = candidate1
        } else if (candidate2) {
            dataDir = path.join(candidate2, ".local/share/yah/")
        } else {
            throw new Error("Cannot determine a safe place to put yah files")
        }

        return dataDir
    }

    public static async Read(relativeFilepath: string) {
        return readFile(await FileStore.GetFullPath(relativeFilepath))
    }

    public static async Write(relativeFilepath: string, buffer: string | Uint8Array) {
        const fullPath = await FileStore.GetFullPath(relativeFilepath)
        await mkdir(path.dirname(fullPath), {recursive: true})
        await writeFile(fullPath, buffer)
    }

    public static async Exists(relativeFilepath: string) {
        try {
            const fullPath = await FileStore.GetFullPath(relativeFilepath)
            const stats = await stat(fullPath)
            return stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()
        } catch(e) {
            return false
        }
    }

    public static async GetFullPath(relativeFilepath: string) {
        const dataDir = path.resolve(FileStore.GetDataDir())
        const fullPath = path.resolve(dataDir, relativeFilepath)
        if (fullPath !== dataDir && !fullPath.startsWith(`${dataDir}${path.sep}`)) {
            throw new Error("FileStore paths must stay inside the YAH data directory")
        }
        return fullPath
    }
}
