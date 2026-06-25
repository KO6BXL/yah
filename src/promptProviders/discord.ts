import {
    Client,
    GatewayIntentBits,
    TextChannel,
    type AnyThreadChannel,
} from "discord.js";
import { SecretStore } from "../store/secretStore.ts";
import { type PromptProvider } from "./prompt-provider.ts";
import { SessionStore } from "../store/sessions.ts";

export class Discord implements PromptProvider {
    client: Client
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    mainChannel: string
    token: string
    threadSessions = new Map<string, string>()
    private constructor(client: Client, mainChannel: string, token: string) {
        client.on("messageCreate", (message) => {
            const user = client.user
            if (!user || message.author.bot) {
                return
            }
            if (message.channel.isThread() && message.channel.parentId === this.mainChannel) {
                const sessionId = this.sessionIdFromThread(message.channel)
                if (!sessionId) {
                    return
                }
                this.threadSessions.set(message.channelId, sessionId)
                this.callbacks.forEach((f) => {
                    Promise.resolve(f(message.content.trim(), message.channelId)).catch(console.error)
                })
                return
            }
            if (message.channelId != this.mainChannel) {
                return
            }
            if (message.mentions.has(user)) {
                const prompt = message.content.replace(new RegExp(`<@!?${user.id}>`, "g"), "").trim()
                this.callbacks.forEach((f) => {
                    Promise.resolve(f(prompt, message.channelId)).catch(console.error)
                })
            }
        })
        this.token = token
        this.client = client
        this.mainChannel = mainChannel
    }

    public static async create(mainChannel: string) {
        const token = SecretStore.get("DISCORD_BOT_TOKEN")
        if (!token) {
            throw new Error("No discord token found!")
        }
        const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages]})
        return new Discord(client, mainChannel, token)
    }

    public  start() {
        try {
            return this.client.login(this.token).then(async (token) => {
                if (!this.client.isReady()) {
                    await new Promise<void>((resolve) => {
                        this.client.once("clientReady", () => resolve())
                    })
                }
                await this.client.application?.commands.set([])
                return token
            })
        } catch(e) {
            throw e
        }
    }

    public async subscribe(callback: (prompt: string, user: string) => void | Promise<void>) {
        this.callbacks.push(callback)
    }

    public async post(message: string, user: string) {
        const chan = await this.client.channels.fetch(user)
        if (chan?.isTextBased()) {
            await chan.send(message)
        }
    }

    public async openSession(sessionId: string) {
        const normalized = SessionStore.normalize(sessionId)
        const thread = await this.findOrCreateSessionThread(normalized)
        this.threadSessions.set(thread.id, normalized)
        return thread.id
    }

    public async deleteSession(sessionId: string) {
        const normalized = SessionStore.normalize(sessionId)
        const thread = await this.findSessionThread(normalized)
        if (thread) {
            this.threadSessions.delete(thread.id)
        }
    }

    public getSessionId(user: string) {
        return this.threadSessions.get(user)
    }

    private sessionIdFromThread(thread: Pick<AnyThreadChannel, "name">) {
        try {
            return SessionStore.normalize(thread.name)
        } catch {
            return
        }
    }

    private async findOrCreateSessionThread(sessionId: string) {
        const existing = await this.findSessionThread(sessionId)
        if (existing) {
            if (existing.archived) {
                await existing.setArchived(false)
            }
            return existing
        }

        const mainChannel = await this.client.channels.fetch(this.mainChannel)
        if (!(mainChannel instanceof TextChannel)) {
            throw new Error("Discord session threads require a text channel")
        }
        return mainChannel.threads.create({
            name: sessionId,
            reason: "YAH session thread",
        })
    }

    private async findSessionThread(sessionId: string) {
        const mainChannel = await this.client.channels.fetch(this.mainChannel)
        if (!(mainChannel instanceof TextChannel)) {
            return
        }

        const active = await mainChannel.threads.fetchActive()
        const activeThread = active.threads.find((thread) => thread.name === sessionId)
        if (activeThread) {
            return activeThread
        }

        const archived = await mainChannel.threads.fetchArchived()
        return archived.threads.find((thread) => thread.name === sessionId)
    }
}
