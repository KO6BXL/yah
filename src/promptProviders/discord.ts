import {
    Client,
    GatewayIntentBits,
    type Message,
} from "discord.js";
import { SecretStore } from "../store/secretStore.ts";
import { type PromptProvider } from "./prompt-provider.ts";

export class Discord implements PromptProvider {
    client: Client
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    mainChannel: string
    token: string
    private constructor(client: Client, mainChannel: string, token: string) {
        client.on("messageCreate", (message) => {
            void this.handleMessage(message).catch(console.error)
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
        if (chan?.isSendable()) {
            await chan.send(message)
        }
    }

    private async handleMessage(message: Message) {
        const user = this.client.user
        if (!user || message.author.bot) {
            return
        }
        if (message.channel.isThread() && message.channel.parentId === this.mainChannel) {
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
            if (!prompt) {
                return
            }
            const thread = await message.startThread({
                name: this.threadNameFor(prompt),
                reason: "YAH task thread",
            })
            this.callbacks.forEach((f) => {
                Promise.resolve(f(prompt, thread.id)).catch(console.error)
            })
        }
    }

    private threadNameFor(prompt: string) {
        const title = prompt.replace(/\s+/g, " ").trim().slice(0, 80)
        return title || `task-${Date.now()}`
    }
}
