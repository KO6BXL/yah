import { mkdir, readFile } from "node:fs/promises";
import { FileStore } from "./fileStore.ts";
import path from "node:path";

export class AgentSoul {
    public static async GetAgentsDir() {
        const agentsDir = await FileStore.GetFullPath("agents")
        await mkdir(agentsDir, {recursive: true})
        return agentsDir
    }

    public static async getAgentSoulDir(agentName: string) {
        const soulDir = path.join(await this.GetAgentsDir(), agentName)
        await mkdir(soulDir, {recursive: true})
        return soulDir
    }

    public static async getSoul(agentName: string) {
        const soulDir = await this.getAgentSoulDir(agentName)
        const soulPath = path.join(soulDir, "SOUL.md")

        try {
            return await readFile(soulPath, "utf8")
        } catch (e) {
            if (e instanceof Error && "code" in e && e.code === "ENOENT") {
                return ""
            }
            throw e
        }
    }
}
