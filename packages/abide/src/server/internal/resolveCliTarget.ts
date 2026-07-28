// Where this invocation's calls land, and what they authenticate with — the whole ladder, in one
// place, because four spellings competing for one answer is exactly the kind of thing that ends up
// resolved differently in two files.
//
//   --url / --token          this invocation only        (most explicit)
//   ABIDE_APP_URL / _TOKEN   this environment
//   `connect` (stored)       this user, until `disconnect`
//   nothing                  host the app ourselves      (least explicit)
//
// Flag over env over stored file is the conventional CLI ladder, and it is what makes
// `ABIDE_APP_URL=… ./app` work against a connected binary without disconnecting first: the more
// immediate the spelling, the higher it sits. URL and token resolve INDEPENDENTLY, so `connect`ing
// with a token and then overriding just the URL keeps the credential (which is usually what a
// staging/production pair wants) — and `--token` alone re-credentials a stored target.

import { normalizeOrigin } from './normalizeOrigin.ts'
import { readCliTarget } from './readCliTarget.ts'

export interface ResolvedCliTarget {
    // Absent = no deployment named; the binary hosts the app itself.
    remote?: string
    token?: string
    // Whether `remote`/`token` came from the stored `connect` file, for the REPL banner and `connect`
    // with no argument. Purely informational.
    connected?: string
}

function fromEnv(name: string): string | undefined {
    const raw = Bun.env[name]
    return raw === undefined || raw === '' ? undefined : raw
}

export async function resolveCliTarget(input: {
    appName: string
    url?: string | undefined
    token?: string | undefined
}): Promise<ResolvedCliTarget> {
    const stored = await readCliTarget(input.appName)
    const envUrl = fromEnv('ABIDE_APP_URL')
    const envToken = fromEnv('ABIDE_APP_TOKEN')

    const remote = input.url ?? envUrl ?? stored?.url
    // The stored credential is looked up BY the origin we resolved, not stored beside it: `--url` to a
    // deployment you have logged into should carry that login, and to one you haven't should carry
    // nothing rather than someone else's token.
    const normalizedRemote = remote === undefined ? undefined : normalizeOrigin(remote)
    const storedToken =
        normalizedRemote === undefined ? undefined : stored?.identities?.[normalizedRemote]
    const token = input.token ?? envToken ?? storedToken

    const resolved: ResolvedCliTarget = {}
    if (normalizedRemote !== undefined) resolved.remote = normalizedRemote
    if (token !== undefined) resolved.token = token
    if (stored?.url !== undefined) resolved.connected = normalizeOrigin(stored.url)
    return resolved
}
