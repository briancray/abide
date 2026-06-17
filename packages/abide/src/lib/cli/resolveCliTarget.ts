import { probeAbideServer } from '../bundle/probeAbideServer.ts'
import { spawnEmbeddedServer } from '../bundle/spawnEmbeddedServer.ts'
import { abideLog } from '../shared/abideLog.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { readLastConnection } from '../shared/readLastConnection.ts'
import type { CliTarget } from './types/CliTarget.ts'

// Bound a resume boot so a slow/failed local start falls back to not-connected
// rather than hanging the CLI before the prompt appears.
const AUTO_START_CEILING_MS = 3000

/*
Resolves the connection to resume when the CLI runs without an explicit
connection verb — the terminal analogue of the bundle's resolveLaunchTarget.
Reads the saved intent:
  - embedded         → boot a fresh local instance (bounded; undefined on failure)
  - url, still alive → connect to it
  - url, now dead    → warn, undefined (caller shows the not-connected prompt)
  - nothing recorded → the baked/shell ABIDE_APP_URL default, else undefined
Returns undefined when there's nothing live to talk to.
*/
export async function resolveCliTarget(programName: string): Promise<CliTarget | undefined> {
    const last = await readLastConnection(programName)
    if (last?.kind === 'embedded') {
        try {
            const { url, child } = await spawnEmbeddedServer({
                programName,
                timeoutMs: AUTO_START_CEILING_MS,
            })
            return { url, child }
        } catch (error) {
            abideLog.warn(`could not start local instance: ${messageFromError(error)}`)
            return undefined
        }
    }
    if (last?.kind === 'url') {
        const identity = await probeAbideServer(last.url)
        if (identity) {
            return { url: last.url, token: process.env.ABIDE_APP_TOKEN, name: identity.name }
        }
        abideLog.warn(`last server at ${last.url} is not responding`)
        return undefined
    }
    // Nothing recorded — fall back to the baked default / shell override.
    const appUrl = process.env.ABIDE_APP_URL
    return appUrl ? { url: appUrl, token: process.env.ABIDE_APP_TOKEN } : undefined
}
