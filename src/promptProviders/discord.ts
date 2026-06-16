import { ApplicationCommandOptionType, Client, GatewayIntentBits, TextChannel } from "discord.js";
import { SecretStore } from "../store/secretStore.ts";
import { type PromptCommand, type PromptProvider } from "./prompt-provider.ts";

export class Discord implements PromptProvider {
    client: Client
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    mainChannel: string
    token: string
    commands: PromptCommand[] = []
    private constructor(client: Client, mainChannel: string, token: string) {
        client.on("messageCreate", (message) => {
            const user = client.user
            if (!user || message.channelId != this.mainChannel) {
                return
            }
            if (message.mentions.has(user)) {
                const prompt = message.content.replace(new RegExp(`<@!?${user.id}>`, "g"), "").trim()
                this.callbacks.forEach((f) => {
                    Promise.resolve(f(prompt, message.author.id)).catch(console.error)
                })
            }
        })
        client.on("interactionCreate", (interaction) => {
            if (!interaction.isChatInputCommand() || interaction.channelId !== this.mainChannel) {
                return
            }
            if (!this.commands.some((command) => command.name === interaction.commandName)) {
                return
            }
            const args = interaction.options.getString("args") ?? "";
            const prompt = `/${interaction.commandName}${args ? ` ${args}` : ""}`;
            interaction.reply({content: "Command received.", ephemeral: true}).catch(console.error)
            this.callbacks.forEach((f) => {
                Promise.resolve(f(prompt, interaction.user.id)).catch(console.error)
            })
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
                if (this.commands.length > 0) {
                    if (!this.client.isReady()) {
                        await new Promise<void>((resolve) => {
                            this.client.once("ready", () => resolve())
                        })
                    }
                    await this.client.application?.commands.set(this.commands.map((command) => ({
                        name: command.name,
                        description: command.description,
                        options: command.usage ? [{
                            name: "args",
                            description: command.usage,
                            type: ApplicationCommandOptionType.String,
                            required: false,
                        }] : [],
                    })))
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
        const chan = await this.client.channels.fetch(this.mainChannel)
        if (chan instanceof TextChannel) {
            chan.send(message)
        }
    }

    public setCommands(commands: PromptCommand[]) {
        this.commands = commands
    }
}
