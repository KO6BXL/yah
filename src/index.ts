import { MainAgent } from "./agents/mainAgent.ts";
import { SecretStore } from "./store/secretStore.ts";

try {
    SecretStore.init()
    const agent = await MainAgent.create()
    console.log("hi")
    await agent.start()
} catch(e) {
    console.log(e)
} 