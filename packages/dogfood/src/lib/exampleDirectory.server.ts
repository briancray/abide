// WHERE THE CRM IS ON DISK: `examples/<app>` beside the docs app.

import { directoryAbove } from './directoryAbove.ts'
import type { ExampleResults } from './ExampleResults.ts'

const APP_NAME = /^crm$/

/** The CRM's directory, or `undefined` for a name that is not one — a name is never a path. */
export function exampleDirectory(app: string): string | undefined {
    if (!APP_NAME.test(app)) return undefined
    const above = directoryAbove(`examples/${app}/package.json`)
    return above && `${above}/examples/${app}`
}

let crm: string | undefined

/** The CRM's directory, found once — a docs app with no CRM above it is a build that cannot serve. */
export function crmDirectory(): string {
    crm ??= exampleDirectory('crm')
    if (crm === undefined) throw new Error('docs: no CRM above the docs app')
    return crm
}

/** What `bun run examples:results` last kept for `app`, or `null` where this build never ran it. */
export async function exampleResults(
    app: string,
): Promise<ExampleResults | null> {
    const directory = exampleDirectory(app)
    const kept = directory && Bun.file(`${directory}/.abide/results.json`)
    return kept && (await kept.exists())
        ? ((await kept.json()) as ExampleResults)
        : null
}
