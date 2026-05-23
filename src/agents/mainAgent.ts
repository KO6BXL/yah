import { type KnownProvider } from "@earendil-works/pi-ai";
import { UniqueBackend } from "../backends/unique.ts";
import { Discord } from "../promptProviders/discord.ts";
import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type PromptProvider } from "../promptProviders/prompt-provider.ts";
import { Telegram } from "../promptProviders/telegram.ts";
import { AgentSoul } from "../store/agentSoul.ts";

export type promptProvider = "discord" | "telegram"

export type MainAgentConfig = {
    chanId?: string,
}

export class MainAgent {
    backend: UniqueBackend
    pProv: PromptProvider
    user: string
    private outputBuf = ""

    constructor(backend: UniqueBackend, pProv: PromptProvider) {
        this.backend = backend
        this.pProv = pProv
        this.user = ""
        pProv.subscribe((prompt, user) => MainAgent.handlePrompt(this, prompt, user))
        backend.subscribe((event) => MainAgent.handleAgentEvent(this, event))
    }

    public static async create(pProvName: promptProvider, provider: KnownProvider, model: string, agentName: string, config: MainAgentConfig) {
        const soul = await AgentSoul.getSoul(agentName)
        const systemPrompt = `You are an agent that has control over a user's computer. In your description, if other files are provided to read, read them before you begin working. If there's no description, remind the user you can help them create one. Your description is: ${soul}`
        const backend = await UniqueBackend.create(provider, model, systemPrompt)
        let pProv: PromptProvider 
        switch (pProvName) {
            case "discord":
                if (!config.chanId) {
                    throw new Error("No channel ID given for discord provider")
                }
                pProv = await Discord.create(config.chanId)
                break
            case "telegram":
                pProv = await Telegram.create()
                break
        }

        return new MainAgent(backend, pProv)
    }  

    public start() {
        return this.pProv.start()
    }

    public dispose() {
        try {
            this.backend.dispose()
        } catch (e) {
            throw e
        }

    }

    public static async handlePrompt(agent: MainAgent, prompt: string, user: string) {
        agent.user = user
        await agent.backend.prompt(prompt)
    }

    public static handleAgentEvent(agent: MainAgent, event: AgentSessionEvent) {
         if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            agent.outputBuf = agent.outputBuf.concat(event.assistantMessageEvent.delta)
        }
         if (event.type === "message_end") {
            console.log(agent.outputBuf)
            if(!agent.outputBuf) {
                return
            }
            agent.pProv.post(agent.outputBuf, agent.user)
            agent.outputBuf = ""
        }
    }
}
