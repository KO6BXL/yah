export type PromptCommand = {
    name: string
    description: string
    usage: string
}

export interface PromptProvider {
    subscribe(callback: (prompt: string, user: string) => void | Promise<void>): void
    post(message: string, user: string): void | Promise<void>
    start(): Promise<string | void>
    setCommands?(commands: PromptCommand[]): Promise<void> | void
    openSession?(sessionId: string, user: string): Promise<string | void> | string | void
    deleteSession?(sessionId: string): Promise<void> | void
    getSessionId?(user: string): string | undefined
}
