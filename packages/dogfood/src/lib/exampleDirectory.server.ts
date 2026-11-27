// WHERE THE CRM IS ON DISK: `examples/crm` beside the docs app, and the workspace both are in.

import { directoryAbove } from './directoryAbove.ts'
import type { ExampleResults } from './ExampleResults.ts'

/** The CRM's directory, or `undefined` where no CRM is above the docs app. */
export function exampleDirectory(): string | undefined {
    const above = directoryAbove('examples/crm/package.json')
    return above && `${above}/examples/crm`
}

let crm: string | undefined

/** The CRM's directory, found once — a docs app with no CRM above it is a build that cannot serve. */
export function crmDirectory(): string {
    crm ??= exampleDirectory()
    if (crm === undefined) throw new Error('docs: no CRM above the docs app')
    return crm
}

let workspace: string | undefined

/** The workspace's root, found once: the nearest directory above the docs app holding `docs/RULEBOOK.md`. */
export function workspaceDirectory(): string {
    workspace ??= directoryAbove('docs/RULEBOOK.md')
    if (workspace === undefined)
        throw new Error('docs: no workspace above the docs app')
    return workspace
}

/** What `bun run examples:results` last kept for the CRM, or `null` where this build never ran it. */
export async function exampleResults(): Promise<ExampleResults | null> {
    const directory = exampleDirectory()
    const kept = directory && Bun.file(`${directory}/.abide/results.json`)
    return kept && (await kept.exists())
        ? ((await kept.json()) as ExampleResults)
        : null
}
