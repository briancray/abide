// What this user's binary remembers: the deployment `connect` pointed at, and the credential `login`
// stored for each origin. Undefined when it remembers nothing.
//
// Every failure reads as "not connected": a missing file is the normal case, and a corrupt or
// hand-edited one must not brick a binary that can always fall back to hosting the app itself.

import { cliTargetPath } from './cliTargetPath.ts'

export interface CliTarget {
    // The deployment `connect` pointed at, if any. Absent = not connected (the binary hosts the app).
    url?: string
    // Credentials keyed by ORIGIN, because that is what a credential IS: a sealed identity issued by
    // one deployment, meaningless (and not to be sent) to another. Keying them this way is why
    // `connect` never has to reason about credentials at all — moving staging→prod→staging keeps both
    // logins, and `logout` drops exactly one.
    identities?: Record<string, string>
}

export async function readCliTarget(appName: string): Promise<CliTarget | undefined> {
    let parsed: unknown
    try {
        parsed = await Bun.file(cliTargetPath(appName)).json()
    } catch {
        return undefined
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const target: CliTarget = {}
    if (typeof record.url === 'string' && record.url.length > 0) target.url = record.url
    if (typeof record.identities === 'object' && record.identities !== null) {
        const identities: Record<string, string> = {}
        for (const [origin, token] of Object.entries(
            record.identities as Record<string, unknown>,
        )) {
            if (typeof token === 'string' && token.length > 0) identities[origin] = token
        }
        if (Object.keys(identities).length > 0) target.identities = identities
    }
    if (target.url === undefined && target.identities === undefined) return undefined
    return target
}
