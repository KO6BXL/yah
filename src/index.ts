import { MainAgent } from "./agents/mainAgent.ts";
import { Dashboard } from "./dashboard/dashboard.ts";
import { loadConfig } from "./store/config.ts";
import { FileStore } from "./store/fileStore.ts";
import { SecretStore } from "./store/secretStore.ts";
import path from "node:path";

let agent: MainAgent | undefined
let dashboard: Dashboard | undefined

function cleanUp() {
    dashboard?.dispose()
    agent?.dispose()
    process.exit(0)
}


process.on("SIGINT", cleanUp)
process.on("SIGTERM", cleanUp)

SecretStore.init()
const config = loadConfig(path.join(FileStore.GetDataDir(), "agent.yaml"))
dashboard = new Dashboard(config)
dashboard.start()
agent = await MainAgent.create()
await agent.start()
