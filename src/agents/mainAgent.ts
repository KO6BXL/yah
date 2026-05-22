import { type KnownProvider } from "@earendil-works/pi-ai";
import { UniqueBackend } from "../backends/unique.ts";
import { Discord } from "../promptProviders/discord.ts";
import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type promptProvider = "discord"

export class MainAgent {
    backend: UniqueBackend
    pProv: PromptProvider
    private outputBuf = ""

    constructor(backend: UniqueBackend, pProv: PromptProvider) {
        this.backend = backend
        this.pProv = pProv
        pProv.subscribe((prompt) => MainAgent.handlePrompt(this, prompt))
        backend.subscribe((event) => MainAgent.handleAgentEvent(this, event))
    }

    public static async create(pProvName: promptProvider, provider: KnownProvider, model: string, chanId?: string) {
        const backend = await UniqueBackend.create(provider, model)
        let pProv: PromptProvider 
        switch (pProvName) {
            case "discord":
                if (!chanId) {
                    throw new Error("No channel ID given for discord provider")
                }
                pProv = await Discord.create(chanId)
        }

        return new MainAgent(backend, pProv)
    }  

    public start() {
        return this.pProv.start()
    }

    public dispose() {
        this.backend.dispose()
    }

    public static async handlePrompt(agent: MainAgent, prompt: string) {
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
            agent.pProv.post(agent.outputBuf)
            agent.outputBuf = ""
        }
    }
}