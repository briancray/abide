// `disconnect` — forget the deployment `connect` stored, and go back to hosting the app.
//
// Drops WHERE and only where: credentials stay, because they are keyed by origin and belong to the
// deployments that issued them. Disconnecting from production and reconnecting to it later should not
// have silently thrown away your login — `logout` is the command that means that.
//
// Reports what it disconnected FROM rather than a bare "ok": the whole hazard of a remembered target
// is not knowing which one you had, and that is never truer than at the moment you drop it.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { type CliTarget, readCliTarget } from './readCliTarget.ts'
import { writeCliTarget } from './writeCliTarget.ts'

export async function disconnectCommand(options: {
    appName: string
    write(text: string): void
}): Promise<number> {
    const stored = await readCliTarget(options.appName)
    if (stored?.url === undefined) {
        options.write(`${options.appName} was not connected — it already hosts the app itself.\n`)
        return CLI_EXIT_CODES.ok
    }
    const next: CliTarget = { ...stored }
    delete next.url
    // Nothing left worth a file: clear it rather than leaving an empty husk behind.
    writeCliTarget(options.appName, next.identities === undefined ? undefined : next)
    options.write(
        `${options.appName} disconnected from ${stored.url} — it now hosts the app. Credentials are kept; \`logout\` drops one.\n`,
    )
    return CLI_EXIT_CODES.ok
}
