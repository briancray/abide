// WHERE THE CRM IS ON DISK: `examples/crm` beside the docs app, and the workspace both are in.

import { directoryAbove } from './directoryAbove.ts'
import type { ExampleResults } from './ExampleResults.ts'

let crm: string | null | undefined

/** The CRM's directory, found once, or `undefined` where no CRM is above the docs app. */
export function exampleDirectory(): string | undefined {
    if (crm === undefined) {
        const above = directoryAbove('examples/crm/package.json')
        crm = above === undefined ? null : `${above}/examples/crm`
    }
    return crm ?? undefined
}

/** The CRM's directory — a docs app with no CRM above it is a build that cannot serve. */
export function crmDirectory(): string {
    const found = exampleDirectory()
    if (found === undefined) throw new Error('docs: no CRM above the docs app')
    return found
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
