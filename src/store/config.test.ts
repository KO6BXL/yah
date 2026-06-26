import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
    test("defaults dashboard settings to disabled localhost", async () => {
        const dataDir = await mkdtemp(join(tmpdir(), "yah-config-"))
        const configPath = join(dataDir, "agent.yaml")
        await writeFile(configPath, [
            "promptProvider: discord",
            "agentProvider: openai",
            "model: gpt-5",
            "channelId: \"123\"",
        ].join("\n"))

        try {
            expect(loadConfig(configPath).dashboard).toEqual({
                enabled: false,
                host: "127.0.0.1",
                port: 8787,
            })
        } finally {
            await rm(dataDir, {recursive: true, force: true})
        }
    })
})
