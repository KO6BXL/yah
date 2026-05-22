interface PromptProvider {
    subscribe(callback: (prompt: string) => void | Promise<void>): void
    post(message: string): void
    start(): Promise<string>
}