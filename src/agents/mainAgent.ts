import { UniqueBackend } from "../backends/unique.ts";
import { Discord } from "../promptProviders/discord.ts";
import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type PromptProvider } from "../promptProviders/prompt-provider.ts";
import { loadConfig } from "../store/config.ts";
import { FileStore } from "../store/fileStore.ts";
import path from "node:path";
import { type KnownProvider } from "@earendil-works/pi-ai";
import { ContextAssembly } from "../context/assembly.ts";

type ThreadState = {
    backend: UniqueBackend
    outputBuf: string
}

export class MainAgent {
    agentProvider: KnownProvider
    model: string
    pProv: PromptProvider
    systemPrompt: string
    private threads = new Map<string, ThreadState>()

    constructor(agentProvider: KnownProvider, model: string, systemPrompt: string, pProv: PromptProvider) {
        this.agentProvider = agentProvider
        this.model = model
        this.pProv = pProv
        this.systemPrompt = systemPrompt
        pProv.subscribe((prompt, user) => MainAgent.handlePrompt(this, prompt, user))
    }

    public static async create() {
        const conf = loadConfig(path.join(FileStore.GetDataDir(), "agent.yaml"))
        const systemPrompt = [
            "You are YAH, a Discord-thread agent for a user's computer.",
            "Treat each Discord thread as the active task context.",
            "Keep channel and category memory boundaries in mind; category-wide changes require explicit user approval.",
        ].join(" ")
        const pProv: PromptProvider = await (async () => {
            switch (conf.promptProvider) {
            case "discord":
                return Discord.create(conf.channelId)
            default:
                throw new Error(`Unsupported prompt provider: ${conf.promptProvider satisfies never}`)
            }
        })()

        return new MainAgent(conf.agentProvider, conf.model, systemPrompt, pProv)
    }  

    public start() {
        return this.pProv.start()
    }

    public dispose() {
        this.threads.forEach((thread) => thread.backend.dispose())
    }

    public async prompt(prompt: string, threadId: string) {
        const thread = await this.getThread(threadId)
        await thread.backend.prompt(prompt)
    }

    public static async handlePrompt(agent: MainAgent, prompt: string, threadId: string) {
        await agent.prompt(prompt, threadId)
    }

    public static async handleAgentEvent(agent: MainAgent, threadId: string, event: AgentSessionEvent) {
        const thread = agent.threads.get(threadId)
        if (!thread) {
            return
        }
         if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            thread.outputBuf = thread.outputBuf.concat(event.assistantMessageEvent.delta)
        }
         if (event.type === "message_end") {
            if(!thread.outputBuf) {
                return
            }
            await agent.pProv.post(thread.outputBuf, threadId)
            thread.outputBuf = ""
        }
    }

    private async getThread(threadId: string) {
        const existing = this.threads.get(threadId)
        if (existing) {
            return existing
        }

        const context = await ContextAssembly.assembleForThread(threadId, this.systemPrompt)
        const backend = await UniqueBackend.create(this.agentProvider, this.model, threadId, context.systemPrompt)
        const thread: ThreadState = {backend, outputBuf: ""}
        this.threads.set(threadId, thread)
        backend.subscribe((event) => {
            void MainAgent.handleAgentEvent(this, threadId, event).catch(console.error)
        })
        return thread
    }
}
