// `connect [url]` — point this binary at a deployment until `disconnect`.
//
// WHERE only. Who you are there is `login`/`logout`, and keeping the two apart is not tidiness: a
// credential belongs to an ORIGIN, so moving staging→prod→staging must not disturb either login, and
// re-pointing must never silently carry one deployment's token to another. When `connect` owned a
// `--token` this file needed a rule about when to keep it across a re-connect; keyed by origin, the
// rule stopped existing.
//
// The counterpart to `serve`: one says host the app here, the other says talk to the one running
// there. Both are reserved subcommands rather than flags because both CHANGE WHAT THE BINARY IS FOR,
// and a flag that quietly rewrites state for every future invocation is the kind of thing you cannot
// tell by looking at the next command line.
//
// With no url it REPORTS instead of setting, so `connect` is also how you answer "what am I talking
// to?" — which a bare run cannot show you once the answer lives in a file.

import { normalizeOrigin } from '../internal/normalizeOrigin.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { readCliTarget } from './readCliTarget.ts'
import { writeCliTarget } from './writeCliTarget.ts'

export interface ConnectCommandOptions {
    appName: string
    // argv after the `connect` word.
    argv: string[]
    write(text: string): void
    writeError(text: string): void
}

// An absolute http(s) origin. A bare host (`app.example.com`) is a mistake worth catching here rather
// than at the first fetch, where it surfaces as an unhelpful "unreachable".
function parseUrl(raw: string): string | undefined {
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        return undefined
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return normalizeOrigin(raw)
}

export async function connectCommand(options: ConnectCommandOptions): Promise<number> {
    let url: string | undefined
    for (const argument of options.argv) {
        if (argument.startsWith('-')) {
            options.writeError(
                `connect: unknown flag ${argument} — a credential is \`login --token <t>\`.\n`,
            )
            return CLI_EXIT_CODES.usage
        }
        url = argument
    }

    const stored = await readCliTarget(options.appName)

    if (url === undefined) {
        options.write(
            stored?.url === undefined
                ? `${options.appName} is not connected — it hosts the app itself.\n`
                : `${options.appName} is connected to ${stored.url}${stored.identities?.[stored.url] === undefined ? '' : ' (logged in)'}.\n`,
        )
        return CLI_EXIT_CODES.ok
    }

    const normalized = parseUrl(url)
    if (normalized === undefined) {
        options.writeError(`connect: "${url}" is not an http(s) url.\n`)
        return CLI_EXIT_CODES.usage
    }

    // Credentials are carried over untouched — they are keyed by origin, so they belong to whichever
    // deployment issued them regardless of which one is currently connected.
    const next = { ...stored, url: normalized }
    writeCliTarget(options.appName, next)
    options.write(
        `${options.appName} is connected to ${normalized}${next.identities?.[normalized] === undefined ? '' : ' (logged in)'}.\n`,
    )
    return CLI_EXIT_CODES.ok
}
