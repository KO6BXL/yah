import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {z} from "zod";

const configSchema = z.object({
    promptProvider: z.literal(["discord", "telegram"]),
    agentProvider: z.literal(["amazon-bedrock" , "anthropic" , "google" , "google-vertex" , "openai" , "azure-openai-responses" , "openai-codex" , "deepseek" , "github-copilot" , "xai" , "groq" , "cerebras" , "openrouter" , "vercel-ai-gateway" , "zai" , "mistral" , "minimax" , "minimax-cn" , "moonshotai" , "moonshotai-cn" , "huggingface" , "fireworks" , "together" , "opencode" , "opencode-go" , "kimi-coding" , "cloudflare-workers-ai" , "cloudflare-ai-gateway" , "xiaomi" , "xiaomi-token-plan-cn" , "xiaomi-token-plan-ams" , "xiaomi-token-plan-sgp"]),
    model: z.string(),
    agentName: z.string(),
    channelId: z.optional(z.string()),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(path: string): Config {
    const text = readFileSync(path).toString()
    const raw: unknown = parse(text)
    return configSchema.parse(raw)
}