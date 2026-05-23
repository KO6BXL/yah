import { Bot } from "grammy";
import { type PromptProvider } from "./prompt-provider.ts";
import { SecretStore } from "../store/secretStore.ts";

export class Telegram implements PromptProvider {
    bot: Bot
    callbacks: ((prompt: string, user: string) => void | Promise<void>)[] = [() => {}]
    constructor(bot: Bot) {
        bot.on("message:text", (ctx) => {
            this.callbacks.forEach(async (F) => {
                Promise.resolve(F(ctx.message.text, (await ctx.getAuthor()).user.id.toString())).catch(console.error)
            })
        })
        this.bot = bot
    }

    public static async create() {
        const token = SecretStore.get("TELEGRAM_BOT_TOKEN")
        if (!token) {
            throw new Error("No telegram token found!")
        }
        const bot = new Bot(token)
        return new Telegram(bot)
    }
    public subscribe(callback: (prompt: string, user: string) => void | Promise<void>) {
        this.callbacks.push(callback)
    }
    public post(message: string, user: string) {
        this.bot.api.sendMessage(user, message)
    }
    public async start(): Promise<void> {
        return this.bot.start()
    }
}