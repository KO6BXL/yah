import {env} from 'node:process'
import dotenv from 'dotenv'
import { FileStore } from './fileStore.ts'
import path from 'node:path'

type EnvironmentKeys = "DISCORD_BOT_TOKEN" | "DATA_DIR" | "HOME" | "TELEGRAM_BOT_TOKEN"

export class SecretStore {
    public static init() {
        dotenv.config({path: path.join(FileStore.GetDataDir(), ".env")})
    }

    public static get(key: EnvironmentKeys) {
        return env[key]
    }
    public static set(key: EnvironmentKeys, value: string) {
        env[key] = value
    }
}