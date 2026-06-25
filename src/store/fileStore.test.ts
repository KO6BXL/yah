import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecretStore } from "./secretStore.ts";
import { FileStore } from "./fileStore.ts";

let dataDir: string
let previousDataDir: string | undefined

beforeEach(async () => {
    previousDataDir = process.env.DATA_DIR
    dataDir = await mkdtemp(join(tmpdir(), "yah-filestore-"))
    SecretStore.set("DATA_DIR", dataDir)
})

afterEach(async () => {
    if (previousDataDir === undefined) {
        delete process.env.DATA_DIR
    } else {
        SecretStore.set("DATA_DIR", previousDataDir)
    }
    await rm(dataDir, {recursive: true, force: true})
})

describe("FileStore", () => {
    test("writes nested files inside the data directory", async () => {
        await FileStore.Write("nested/example.txt", "hello")

        await expect(FileStore.Exists("nested/example.txt")).resolves.toBe(true)
        await expect(FileStore.Read("nested/example.txt")).resolves.toEqual(Buffer.from("hello"))
    })

    test("rejects paths that escape the data directory", async () => {
        await expect(FileStore.GetFullPath("../outside.txt")).rejects.toThrow("inside the YAH data directory")
        await expect(FileStore.Write("../outside.txt", "nope")).rejects.toThrow("inside the YAH data directory")
    })
})
