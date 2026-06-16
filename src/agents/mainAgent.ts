import { UniqueBackend } from "../backends/unique.ts";
import { Discord } from "../promptProviders/discord.ts";
import { type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type PromptCommand, type PromptProvider } from "../promptProviders/prompt-provider.ts";
import { Telegram } from "../promptProviders/telegram.ts";
import { AgentSoul } from "../store/agentSoul.ts";
import { loadConfig } from "../store/config.ts";
import { FileStore } from "../store/fileStore.ts";
import { DEFAULT_SESSION_ID, SessionStore } from "../store/sessions.ts";
import path from "node:path";
import { type KnownProvider } from "@earendil-works/pi-ai";

export type PromptProviderName = "discord" | "telegram"

export type MainAgentConfig = {
    chanId?: string,
}

type SessionState = {
    backend: UniqueBackend
    outputBuf: string
}

const PROMPT_COMMANDS: PromptCommand[] = [
    {
        name: "session",
        description: "Manage YAH sessions",
        usage: "list | current | new [name] | use <name> | delete <name>",
    },
    {
        name: "sessions",
        description: "List YAH sessions",
        usage: "",
    },
]

export class MainAgent {
    agentProvider: KnownProvider
    model: string
    pProv: PromptProvider
    systemPrompt: string
    private sessions = new Map<string, SessionState>()
    private currentSessionByUser = new Map<string, string>()
    private userBySession = new Map<string, string>()

    constructor(agentProvider: KnownProvider, model: string, systemPrompt: string, pProv: PromptProvider) {
        this.agentProvider = agentProvider
        this.model = model
        this.pProv = pProv
        this.systemPrompt = systemPrompt
        pProv.subscribe((prompt, user) => MainAgent.handlePrompt(this, prompt, user))
    }

    public static async create() {
        const conf = loadConfig(path.join(FileStore.GetDataDir(), "agent.yaml"))
        const soul = await AgentSoul.getSoul(conf.agentName)
        const systemPrompt = `You are an agent that has control over a user's computer. In your description, if other files are provided to read, read them before you begin working. If there's no description, remind the user you can help them create one. Your description is: ${soul}`
        const pProv: PromptProvider = await (async () => {
            switch (conf.promptProvider) {
            case "discord":
                if (!conf.channelId) {
                    throw new Error("No channel ID given for discord provider")
                }
                return Discord.create(conf.channelId)
            case "telegram":
                return Telegram.create()
            default:
                throw new Error(`Unsupported prompt provider: ${conf.promptProvider satisfies never}`)
            }
        })()
        await pProv.setCommands?.(PROMPT_COMMANDS)

        return new MainAgent(conf.agentProvider, conf.model, systemPrompt, pProv)
    }  

    public start() {
        return this.pProv.start()
    }

    public dispose() {
        this.sessions.forEach((session) => session.backend.dispose())
    }

    public async prompt(prompt: string, user = "system", sessionId = DEFAULT_SESSION_ID) {
        const session = await this.getSession(sessionId)
        this.userBySession.set(sessionId, user)
        await session.backend.prompt(prompt)
    }

    public static async handlePrompt(agent: MainAgent, prompt: string, user: string) {
        const commandResponse = await agent.handleCommand(prompt, user)
        if (commandResponse) {
            await agent.pProv.post(commandResponse, user)
            return
        }

        const sessionId = agent.currentSessionByUser.get(user) ?? DEFAULT_SESSION_ID
        await agent.prompt(prompt, user, sessionId)
    }

    public static async handleAgentEvent(agent: MainAgent, sessionId: string, event: AgentSessionEvent) {
        const session = agent.sessions.get(sessionId)
        if (!session) {
            return
        }
         if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            session.outputBuf = session.outputBuf.concat(event.assistantMessageEvent.delta)
        }
         if (event.type === "message_end") {
            console.log(session.outputBuf)
            if(!session.outputBuf) {
                return
            }
            const user = agent.userBySession.get(sessionId)
            if (user) {
                await agent.pProv.post(session.outputBuf, user)
            }
            session.outputBuf = ""
        }
    }

    private async getSession(sessionId: string) {
        const normalized = SessionStore.normalize(sessionId)
        const existing = this.sessions.get(normalized)
        if (existing) {
            return existing
        }

        const backend = await UniqueBackend.create(this.agentProvider, this.model, normalized, this.systemPrompt)
        const session: SessionState = {backend, outputBuf: ""}
        this.sessions.set(normalized, session)
        backend.subscribe((event) => {
            void MainAgent.handleAgentEvent(this, normalized, event).catch(console.error)
        })
        return session
    }

    private async handleCommand(prompt: string, user: string) {
        const parts = prompt.trim().split(/\s+/).filter(Boolean)
        const command = parts[0]?.toLowerCase()
        if (!command || (command !== "/session" && command !== "/sessions")) {
            return
        }

        if (command === "/sessions") {
            return this.formatSessionList(user)
        }

        const action = parts[1]?.toLowerCase() ?? "help"
        switch (action) {
        case "list":
            return this.formatSessionList(user)
        case "current":
            return `Current session: ${this.currentSessionByUser.get(user) ?? DEFAULT_SESSION_ID}`
        case "new": {
            const sessionId = SessionStore.normalize(parts[2] ?? `session-${Date.now()}`)
            await this.getSession(sessionId)
            this.currentSessionByUser.set(user, sessionId)
            return `Created and switched to session: ${sessionId}`
        }
        case "use": {
            if (!parts[2]) {
                return "Usage: /session use <name>"
            }
            const sessionId = SessionStore.normalize(parts[2])
            await this.getSession(sessionId)
            this.currentSessionByUser.set(user, sessionId)
            return `Switched to session: ${sessionId}`
        }
        case "delete": {
            if (!parts[2]) {
                return "Usage: /session delete <name>"
            }
            const sessionId = SessionStore.normalize(parts[2])
            this.sessions.get(sessionId)?.backend.dispose()
            this.sessions.delete(sessionId)
            await SessionStore.delete(sessionId)
            this.currentSessionByUser.forEach((currentSessionId, sessionUser) => {
                if (currentSessionId === sessionId) {
                    this.currentSessionByUser.set(sessionUser, DEFAULT_SESSION_ID)
                }
            })
            return `Deleted session: ${sessionId}`
        }
        case "help":
            return "Usage: /session list | current | new [name] | use <name> | delete <name>"
        default:
            return "Unknown session command. Usage: /session list | current | new [name] | use <name> | delete <name>"
        }
    }

    private async formatSessionList(user: string) {
        const sessions = new Set(await SessionStore.list())
        this.sessions.forEach((_session, sessionId) => sessions.add(sessionId))
        sessions.add(DEFAULT_SESSION_ID)
        const current = this.currentSessionByUser.get(user) ?? DEFAULT_SESSION_ID
        return [...sessions].sort().map((sessionId) => sessionId === current ? `* ${sessionId}` : `  ${sessionId}`).join("\n")
    }
}
