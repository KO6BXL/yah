import path from "node:path";
import { MainAgent } from "./agents/mainAgent.ts";
import { SecretStore } from "./store/secretStore.ts";
import { FileStore } from "./store/fileStore.ts";
import { rm } from "node:fs/promises";

async function cleanUp() {
    const sessionPath = path.join(FileStore.GetDataDir(), "session/session.jsonl")
    await rm(sessionPath)
    process.exit(0)
}

process.on("SIGINT", cleanUp)
process.on("SIGTERM", cleanUp)

SecretStore.init()
const agent = await MainAgent.create()
console.log("hi")
await agent.start()
