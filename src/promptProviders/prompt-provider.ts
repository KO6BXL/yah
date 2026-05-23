export interface PromptProvider {
    subscribe(callback: (prompt: string, user: string) => void | Promise<void>): void
    post(message: string, user: string): void
    start(): Promise<string | void>
}