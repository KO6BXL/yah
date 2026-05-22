import { MainAgent } from "./agents/mainAgent.ts";
import { SecretStore } from "./store/secretStore.ts";

const agent = await MainAgent.create('discord', 'openai-codex', 'gpt-5.5', "1061334423192215615")
SecretStore.init()

try {
    console.log("hi")
    await agent.start()
} catch(e) {
    console.log(e)
} 