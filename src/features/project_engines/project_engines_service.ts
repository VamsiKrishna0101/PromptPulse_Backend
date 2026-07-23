import { Engine } from "@prisma/client"
import prisma from "../../lib/prisma"
import { getEffectivePlanAccess } from "../subscription/entitlements"
import { assertProjectAccess } from "../projects/project_access"
import {
    DEFAULT_PROJECT_ENGINES,
    SELECTABLE_PROJECT_ENGINES,
    getEngineLimitForPlan,
    normalizeProjectEngines,
} from "./project_engine_policy"

// PAYG: all 5 engines available to every user \u2014 only validate non-empty
export async function assertCanUseProjectEngines(userId: string, rawEngines: unknown) {
    const engines = normalizeProjectEngines(rawEngines)

    if (engines.length === 0) {
        throw new Error("Select at least one AI engine.")
    }

    const access = await getEffectivePlanAccess(userId)
    if (access.trial.active && engines.length > 3) {
        throw new Error("Your free trial includes 3 AI engines. Add a plan or credits to unlock all engines.")
    }

    return engines
}


export async function setProjectEngines(projectId: string, userId: string, rawEngines: unknown) {
    await assertProjectAccess(projectId, userId)
    const engines = await assertCanUseProjectEngines(userId, rawEngines)

    await prisma.$transaction(async tx => {
        await tx.projectEnginePreference.upsert({
            where: { project_id_engine: { project_id: projectId, engine: Engine.CHATGPT } },
            create: { project_id: projectId, engine: Engine.CHATGPT, is_active: engines.includes(Engine.CHATGPT) },
            update: { is_active: engines.includes(Engine.CHATGPT) },
        })
        await tx.projectEnginePreference.upsert({
            where: { project_id_engine: { project_id: projectId, engine: Engine.GEMINI } },
            create: { project_id: projectId, engine: Engine.GEMINI, is_active: engines.includes(Engine.GEMINI) },
            update: { is_active: engines.includes(Engine.GEMINI) },
        })
        await tx.projectEnginePreference.upsert({
            where: { project_id_engine: { project_id: projectId, engine: Engine.PERPLEXITY } },
            create: { project_id: projectId, engine: Engine.PERPLEXITY, is_active: engines.includes(Engine.PERPLEXITY) },
            update: { is_active: engines.includes(Engine.PERPLEXITY) },
        })
        await tx.projectEnginePreference.upsert({
            where: { project_id_engine: { project_id: projectId, engine: Engine.GOOGLE_AI_MODE } },
            create: { project_id: projectId, engine: Engine.GOOGLE_AI_MODE, is_active: engines.includes(Engine.GOOGLE_AI_MODE) },
            update: { is_active: engines.includes(Engine.GOOGLE_AI_MODE) },
        })
        await tx.projectEnginePreference.upsert({
            where: { project_id_engine: { project_id: projectId, engine: Engine.COPILOT } },
            create: { project_id: projectId, engine: Engine.COPILOT, is_active: engines.includes(Engine.COPILOT) },
            update: { is_active: engines.includes(Engine.COPILOT) },
        })
    })

    return getProjectEngines(projectId)
}

export async function createDefaultProjectEngines(projectId: string, engines: Engine[] = [...DEFAULT_PROJECT_ENGINES]) {
    const selected = new Set(engines)
    await prisma.projectEnginePreference.createMany({
        data: SELECTABLE_PROJECT_ENGINES.map(engine => ({
            project_id: projectId,
            engine,
            is_active: selected.has(engine),
        })),
        skipDuplicates: true,
    })
}

export async function getProjectEngines(projectId: string): Promise<Engine[]> {
    const rows = await prisma.projectEnginePreference.findMany({
        where: {
            project_id: projectId,
            is_active: true,
            engine: { in: [...SELECTABLE_PROJECT_ENGINES] },
        },
        select: { engine: true },
        orderBy: { created_at: "asc" },
    })

    if (rows.length) return rows.map(row => row.engine)

    await createDefaultProjectEngines(projectId)
    return [...DEFAULT_PROJECT_ENGINES]
}
