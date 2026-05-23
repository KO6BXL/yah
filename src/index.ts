import { MainAgent } from "./agents/mainAgent.ts";
import { SecretStore } from "./store/secretStore.ts";



try {
    SecretStore.init()
    const agent = await MainAgent.create('discord', 'openai-codex', 'gpt-5.5', "bob", {chanId: "1061334423192215615"})
    console.log("hi")
    await agent.start()
} catch(e) {
    console.log(e)
} 