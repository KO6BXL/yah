import {
    Client,
    GatewayIntentBits,
    type Message,
} from "discord.js";
import {
    toDiscordCategoryId,
    toDiscordChannelId,
    toDiscordGuildId,
    toDiscordMessageId,
    toDiscordThreadId,
    type Category,
    type CategoryId,
    type Channel,
    type ChannelId,
    type ContextPermissions,
    type DiscordGuildId,
    type Thread,
} from "../domain/context.ts";
import { ContextStore } from "../store/contextStore.ts";
import { SecretStore } from "../store/secretStore.ts";
import { type PromptProvider } from "./prompt-provider.ts";

export class Discord implements PromptProvider {
    client: Client
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    mainChannel: string
    token: string
    private rootCategoryId?: CategoryId
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
                await this.validateConfiguredChannel()
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
        if (message.channel.isThread()) {
            const context = await this.resolveThreadContext(message)
            if (!context) {
                return
            }
            this.callbacks.forEach((f) => {
                Promise.resolve(f(message.content.trim(), message.channelId)).catch(console.error)
            })
            return
        }

        if (!message.mentions.has(user)) {
            return
        }
        const parentContext = await this.resolveChannelContext(message)
        if (!parentContext) {
            return
        }
        const prompt = message.content.replace(new RegExp(`<@!?${user.id}>`, "g"), "").trim()
        if (!prompt) {
            return
        }
        const thread = await message.startThread({
            name: this.threadNameFor(prompt),
            reason: "YAH task thread",
        })
        await this.registerThread(thread.id, thread.name, message.author.id, message.id, parentContext)
        this.callbacks.forEach((f) => {
            Promise.resolve(f(prompt, thread.id)).catch(console.error)
        })
    }

    private threadNameFor(prompt: string) {
        const title = prompt.replace(/\s+/g, " ").trim().slice(0, 80)
        return title || `task-${Date.now()}`
    }

    private async validateConfiguredChannel() {
        const channel = await this.client.channels.fetch(this.mainChannel)
        if (!channel) {
            throw new Error(`Configured Discord channel ${this.mainChannel} was not found.`)
        }
        if (!("guild" in channel) || !("parentId" in channel) || !channel.parentId) {
            throw new Error("Configured Discord channel must be a guild channel inside a category.")
        }
        if (!channel.isTextBased() || channel.isThread()) {
            throw new Error("Configured Discord channel must be a text channel, not a thread.")
        }

        const parent = channel.parent
        if (!parent) {
            throw new Error("Configured Discord channel category could not be resolved.")
        }

        const context = await this.registerChannel(channel.id, "name" in channel ? channel.name : channel.id, channel.guild.id, parent.id, parent.name)
        this.rootCategoryId = context.categoryId
    }

    private async resolveChannelContext(message: Message) {
        if (!("guild" in message.channel) || !("parentId" in message.channel) || !message.channel.parentId) {
            return undefined
        }
        if (!this.rootCategoryId || message.channel.parentId !== this.rootCategoryId) {
            return undefined
        }
        return this.registerChannel(
            message.channel.id,
            "name" in message.channel ? message.channel.name : message.channel.id,
            message.channel.guild.id,
            message.channel.parentId,
            message.channel.parent?.name ?? message.channel.parentId,
        )
    }

    private async resolveThreadContext(message: Message) {
        if (!message.channel.isThread() || !message.channel.parentId) {
            return undefined
        }
        const parent = message.channel.parent
        if (!parent || !("guild" in parent) || !("parentId" in parent) || !parent.parentId) {
            return undefined
        }
        if (!this.rootCategoryId || parent.parentId !== this.rootCategoryId) {
            return undefined
        }
        const parentContext = await this.registerChannel(
            parent.id,
            "name" in parent ? parent.name : parent.id,
            parent.guild.id,
            parent.parentId,
            parent.parent?.name ?? parent.parentId,
        )
        return this.registerThread(message.channel.id, message.channel.name, message.author.id, undefined, parentContext)
    }

    private async registerChannel(channelIdRaw: string, channelName: string, guildIdRaw: string, categoryIdRaw: string, categoryName: string) {
        const now = new Date().toISOString()
        const categoryId = toDiscordCategoryId(categoryIdRaw)
        const channelId = toDiscordChannelId(channelIdRaw)
        const guildId = toDiscordGuildId(guildIdRaw)
        const defaultPermissions = this.defaultPermissions("category-owner")

        const existingCategory = await ContextStore.readCategory(categoryId)
        const category: Category = {
            kind: "category",
            id: categoryId,
            guildId,
            name: categoryName,
            createdAt: existingCategory?.createdAt ?? now,
            updatedAt: now,
            taskMemory: existingCategory?.taskMemory,
            workingMemory: existingCategory?.workingMemory,
            permissions: existingCategory?.permissions ?? defaultPermissions,
        }
        await ContextStore.writeCategory(category)

        const existingChannel = await ContextStore.readChannel(channelId)
        const contextChannel: Channel = {
            kind: "channel",
            id: channelId,
            guildId,
            parentCategoryId: categoryId,
            name: channelName,
            createdAt: existingChannel?.createdAt ?? now,
            updatedAt: now,
            taskMemory: existingChannel?.taskMemory,
            workingMemory: existingChannel?.workingMemory,
            permissions: existingChannel?.permissions ?? this.defaultPermissions("channel-owner"),
        }
        await ContextStore.writeChannel(contextChannel)
        return {categoryId, channelId, guildId}
    }

    private async registerThread(threadIdRaw: string, threadName: string, startedByUserId: string, sourceMessageId: string | undefined, parentContext: {categoryId: CategoryId, channelId: ChannelId, guildId: DiscordGuildId}) {
        const now = new Date().toISOString()
        const threadId = toDiscordThreadId(threadIdRaw)
        const existingThread = await ContextStore.readThread(threadId)
        const thread: Thread = {
            kind: "thread",
            id: threadId,
            guildId: existingThread?.guildId ?? parentContext.guildId,
            parentCategoryId: parentContext.categoryId,
            parentChannelId: parentContext.channelId,
            name: threadName,
            createdAt: existingThread?.createdAt ?? now,
            updatedAt: now,
            taskMemory: existingThread?.taskMemory,
            workingMemory: existingThread?.workingMemory,
            permissions: existingThread?.permissions ?? this.defaultPermissions("channel-owner"),
            startedByUserId: existingThread?.startedByUserId ?? startedByUserId,
            sourceMessageId: existingThread?.sourceMessageId ?? (sourceMessageId ? toDiscordMessageId(sourceMessageId) : undefined),
            completedAt: existingThread?.completedAt,
        }
        await ContextStore.writeThread(thread)
        return thread
    }

    private defaultPermissions(approvalPolicy: ContextPermissions["approvalPolicy"]): ContextPermissions {
        return {
            ownerUserIds: [],
            approvedRoleIds: [],
            approvalPolicy,
        }
    }
}
