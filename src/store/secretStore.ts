import {env} from 'node:process'

type EnvironmentKeys = "DISCORD_BOT_TOKEN" | "DATA_DIR" | "HOME"

export class SecretStore {
    public static get(key: EnvironmentKeys) {
        return env[key]
    }
    public static set(key: EnvironmentKeys, value: string) {
        env[key] = value
    }
}