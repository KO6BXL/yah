import { getModel, type KnownProvider, type Model } from "@earendil-works/pi-ai";
import { AgentSession, AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { FileStore } from "../store/fileStore.ts";
import { SkillsStore } from "../store/skills.ts";
export class UniqueBackend {
    private authStorage: AuthStorage
    private modelRegistry: ModelRegistry
    private session: AgentSession
    private model: Model<never>

    private constructor(authStorage: AuthStorage, modelRegistry: ModelRegistry, session: AgentSession, model: Model<never>) {
        this.authStorage = authStorage
        this.modelRegistry = modelRegistry
        this.session = session
        this.model = model
    }

    static async create(provider: KnownProvider, model: string) {
        const authStorage = AuthStorage.create(await FileStore.GetFullPath("auth.json"))
        if (!authStorage.hasAuth(provider)) {
            await authStorage.login(provider, {
                onAuth: (info) => {
                    console.log(info.instructions)
                    console.log(info.url)
                },
                onPrompt: (prompt) => {
                    throw new Error(`Need input for ${prompt.message}`)
                },
                onProgress: console.log
            })
        }
        const modelRegistry = ModelRegistry.create(authStorage)
        const mod = getModel(provider, model as never)
        const skills = await SkillsStore.CreateResourceLoader()
        for (const diagnostic of skills.diagnostics) {
            console.warn(`Skill ${diagnostic.type}: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`)
        }
        console.log(`Loaded ${skills.skills.length} skill(s); app skill directory: ${skills.skillsDir}`)
        const res = await createAgentSession({
            model: mod,
            sessionManager: SessionManager.inMemory(),
            authStorage: authStorage,
            modelRegistry: modelRegistry,
            resourceLoader: skills.loader,
        })
        const session = res.session
        return new UniqueBackend(authStorage, modelRegistry, session, mod)
    }

    public subscribe: AgentSession["subscribe"] = (listener) => {
        return this.session.subscribe(listener)
    }


    
    public prompt = (prompt: string) => {
        return this.session.prompt(prompt)
    }

    public dispose = () => {
        this.session.dispose()
    }
}
