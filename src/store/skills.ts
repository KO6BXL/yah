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

    public static async CreateResourceLoader(options: SkillsResourceLoaderOptions = {}): Promise<SkillsResourceLoaderResult> {
        const cwd = options.cwd ?? process.cwd();
        const agentDir = options.agentDir ?? getAgentDir();
        const skillsDir = await SkillsStore.GetSkillsDir();
        const settingsManager = SettingsManager.create(cwd, agentDir);
        const loader = new DefaultResourceLoader({
            cwd,
            agentDir,
            settingsManager,
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
