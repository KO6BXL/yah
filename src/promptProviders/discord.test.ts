import { describe, expect, test } from "bun:test";
import { splitDiscordMessage } from "./discord.ts";

describe("splitDiscordMessage", () => {
    test("returns no chunks for empty messages", () => {
        expect(splitDiscordMessage("")).toEqual([])
    })

    test("keeps chunks within the Discord limit", () => {
        const chunks = splitDiscordMessage("a".repeat(4500))

        expect(chunks).toHaveLength(3)
        expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
        expect(chunks.join("")).toBe("a".repeat(4500))
    })

    test("prefers splitting on whitespace", () => {
        const chunks = splitDiscordMessage("hello world again", 12)

        expect(chunks).toEqual(["hello world ", "again"])
        expect(chunks.join("")).toBe("hello world again")
    })
})
