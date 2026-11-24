// WHERE THE CRM IS ON DISK: `examples/<app>` beside the docs app.

import { directoryAbove } from './directoryAbove.ts'
import type { ExampleResults } from './ExampleResults.ts'

const APP_NAME = /^crm$/

/** The CRM's directory, or `undefined` for a name that is not one — a name is never a path. */
export async function exampleDirectory(
    app: string,
): Promise<string | undefined> {
    if (!APP_NAME.test(app)) return undefined
    const above = directoryAbove(`examples/${app}/package.json`)
    return above && `${above}/examples/${app}`
}

/** What `bun run examples:results` last kept for `app`, or `null` where this build never ran it. */
export async function exampleResults(
    app: string,
): Promise<ExampleResults | null> {
    const directory = await exampleDirectory(app)
    const kept = directory && Bun.file(`${directory}/.abide/results.json`)
    return kept && (await kept.exists())
        ? ((await kept.json()) as ExampleResults)
        : null
}
