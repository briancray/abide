// `identity` — ask the server who it thinks you are (auth.md AU3, `/__abide/identity`).
//
// Named `identity`, not `whoami`, because it is the SAME word the rest of the framework uses for the
// same fact: `identity()` in a handler, `identity()` in a component, `identity` at the command line —
// one vocabulary, three surfaces. A second name would be a second concept.
//
// This is also what makes an opaque credential debuggable: the CLI cannot read its own sealed token
// (by design), so the only honest way to answer "am I logged in, and as whom?" is to ask the server
// and print what it says.

import { IDENTITY_ROUTE } from '../../shared/internal/IDENTITY_ROUTE.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { cliExitCodeForStatus } from './cliExitCodeForStatus.ts'
import { reportUnreachable } from './cliFailure.ts'

export async function identityCommand(options: {
    origin: string
    token?: string | undefined
    pretty: boolean
    write(text: string): void
    writeError(text: string): void
}): Promise<number> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
    let response: Response
    try {
        response = await fetch(`${options.origin}${IDENTITY_ROUTE}`, { headers })
    } catch (caught) {
        return reportUnreachable(options.origin, caught, options.writeError)
    }
    const body = await response.text()
    if (!response.ok) {
        options.writeError(`${body}\n`)
        return cliExitCodeForStatus(response.status)
    }
    // Printed as the same JSON every other command emits, so `identity | jq .authenticated` works.
    try {
        options.write(`${JSON.stringify(JSON.parse(body), null, options.pretty ? 2 : 0)}\n`)
    } catch {
        options.write(`${body}\n`)
    }
    return CLI_EXIT_CODES.ok
}
