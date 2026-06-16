import { MainAgent } from "./agents/mainAgent.ts";
import { SecretStore } from "./store/secretStore.ts";

let agent: MainAgent | undefined

function cleanUp() {
    agent?.dispose()
    process.exit(0)
}

async function kill() {
    process.exit(0)
}

async function fail() {
    process.exit(1)
}

process.on("SIGINT", cleanUp)
process.on("SIGTERM", cleanUp)
process.on("SIGUSR1", kill)
process.on("ENOENT", fail)

SecretStore.init()
agent = await MainAgent.create()
console.log("hi")
await agent.start()
