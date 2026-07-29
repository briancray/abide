// `login --token <t>` — remember WHO this binary is at the deployment it points at (auth.md AU9).
//
// The token is a sealed identity: the server issued it, only the server can open it, and the CLI is a
// courier that must not be able to read (and therefore forge) its own credential. So this stores an
// opaque string and nothing else — there is no client-side notion of "logged in" beyond "I hold a
// credential for that origin".
//
// Stored per ORIGIN, so logging in to staging and to production is two logins, not one that keeps
// overwriting the other; `connect` moves between them without touching either.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { readCliTarget } from './readCliTarget.ts'
import { writeCliTarget } from './writeCliTarget.ts'

export async function loginCommand(options: {
    appName: string
    // The origin this login is FOR — the resolved target, so `--url x login` credentials x.
    origin: string | undefined
    argv: string[]
    write(text: string): void
    writeError(text: string): void
}): Promise<number> {
    let token: string | undefined
    for (let index = 0; index < options.argv.length; index++) {
        const argument = options.argv[index]
        if (argument === undefined) continue
        if (argument === '--token') {
            token = options.argv[++index]
            continue
        }
        if (argument.startsWith('--token=')) {
            token = argument.slice(8)
            continue
        }
        options.writeError(`login: unexpected argument ${argument}\n`)
        return CLI_EXIT_CODES.usage
    }

    if (token === undefined || token.length === 0) {
        options.writeError(
            'login: needs a token — `login --token <t>`. Your app issues one; abide seals it as an identity (auth.md AU9).\n',
        )
        return CLI_EXIT_CODES.usage
    }
    if (options.origin === undefined) {
        options.writeError(
            `login: not connected — \`${options.appName} connect <url>\` first (a credential belongs to one deployment).\n`,
        )
        return CLI_EXIT_CODES.usage
    }

    const stored = (await readCliTarget(options.appName)) ?? {}
    const identities = { ...stored.identities, [options.origin]: token }
    writeCliTarget(options.appName, { ...stored, identities })
    options.write(
        `${options.appName} logged in at ${options.origin} — \`identity\` shows who the server says you are.\n`,
    )
    return CLI_EXIT_CODES.ok
}
