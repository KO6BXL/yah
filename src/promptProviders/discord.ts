import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { SecretStore } from "../store/secretStore.ts";
import { type PromptProvider } from "./prompt-provider.ts";

export class Discord implements PromptProvider {
    client: Client
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    mainChannel: string
    token: string
    private constructor(client: Client, mainChannel: string, token: string) {
        client.on("messageCreate", (message) => {
            const user = client.user
            if (!user || message.channelId != this.mainChannel) {
                return
            }
            if (message.mentions.has(user)) {
                this.callbacks.forEach((f) => {
                    Promise.resolve(f(message.content, message.author.id)).catch(console.error)
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
            return this.client.login(this.token)
        } catch(e) {
            throw e
        }
    }

    public async subscribe(callback: (prompt: string, user: string) => void | Promise<void>) {
        this.callbacks.push(callback)
    }

    public async post(message: string, user: string) {
        const chan = await this.client.channels.fetch(this.mainChannel)
        if (chan instanceof TextChannel) {
            chan.send(message)
        }
    }
}