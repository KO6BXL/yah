export type PromptCommand = {
    name: string
    description: string
    usage: string
}

export interface PromptProvider {
    subscribe(callback: (prompt: string, user: string) => void | Promise<void>): void
    post(message: string, user: string): void
    start(): Promise<string | void>
    setCommands?(commands: PromptCommand[]): Promise<void> | void
}
