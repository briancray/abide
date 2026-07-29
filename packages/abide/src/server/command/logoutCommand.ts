// `logout` — forget the credential this binary holds for the deployment it points at.
//
// LOCAL only, and it says so: dropping a sealed identity from a file does not revoke it server-side
// (abide has no denylist — revocation is expiry plus `ABIDE_IDENTITY_SECRET` rotation, AU9.6). Telling
// the user "logged out" and leaving them believing the token is dead would be the wrong kind of quiet.
//
// The `disconnect` counterpart drops WHERE; this drops WHO. Orthogonal on purpose.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { type CliTarget, readCliTarget } from './readCliTarget.ts'
import { writeCliTarget } from './writeCliTarget.ts'

export async function logoutCommand(options: {
    appName: string
    origin: string | undefined
    write(text: string): void
    writeError(text: string): void
}): Promise<number> {
    if (options.origin === undefined) {
        options.writeError(`logout: not connected — there is no deployment to log out of.\n`)
        return CLI_EXIT_CODES.usage
    }
    const stored = await readCliTarget(options.appName)
    if (stored?.identities?.[options.origin] === undefined) {
        options.write(`${options.appName} holds no credential for ${options.origin}.\n`)
        return CLI_EXIT_CODES.ok
    }
    const identities: Record<string, string> = {}
    for (const [origin, token] of Object.entries(stored.identities)) {
        if (origin !== options.origin) identities[origin] = token
    }
    const next: CliTarget = { ...stored }
    if (Object.keys(identities).length === 0) delete next.identities
    else next.identities = identities
    writeCliTarget(options.appName, next)
    options.write(
        `${options.appName} dropped its credential for ${options.origin}. The token itself is still valid until it expires — revoking it is the server's business (rotate ABIDE_IDENTITY_SECRET).\n`,
    )
    return CLI_EXIT_CODES.ok
}
