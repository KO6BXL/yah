import {
    DefaultResourceLoader,
    SettingsManager,
    getAgentDir,
    type ResourceDiagnostic,
    type Skill,
} from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FileStore } from "./fileStore.ts";

export interface SkillsResourceLoaderOptions {
    cwd?: string;
    agentDir?: string;
    systemPrompt?: string;
}

export interface SkillsResourceLoaderResult {
    loader: DefaultResourceLoader;
    skills: Skill[];
    diagnostics: ResourceDiagnostic[];
    skillsDir: string;
}

export class SkillsStore {
    public static async GetSkillsDir() {
        const skillsDir = await FileStore.GetFullPath("skills");
        await mkdir(skillsDir, { recursive: true });
        return skillsDir;
    }

    public static async GetSkillPath(skillName: string) {
        return path.join(await SkillsStore.GetSkillsDir(), skillName, "SKILL.md");
    }

    public static GetSystemPrompt() {
        return "You are an agent that has control over a user's computer"
    }

    public static async CreateResourceLoader(options: SkillsResourceLoaderOptions = {}): Promise<SkillsResourceLoaderResult> {
        const cwd = options.cwd ?? process.cwd();
        const agentDir = options.agentDir ?? getAgentDir();
        let systemPrompt = ""
        if (options.systemPrompt) {
            systemPrompt = options.systemPrompt
        } else {
            systemPrompt = SkillsStore.GetSystemPrompt()
        }
        const skillsDir = await SkillsStore.GetSkillsDir();
        const settingsManager = SettingsManager.create(cwd, agentDir);
        const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager,
            systemPrompt,
            additionalSkillPaths: [skillsDir],
        });

        await loader.reload();
        const { skills, diagnostics } = loader.getSkills();
        return {
            loader,
            skills,
            diagnostics,
            skillsDir,
        };
    }
}
