import { probeBelteServer } from '../bundle/probeBelteServer.ts'
import { spawnEmbeddedServer } from '../bundle/spawnEmbeddedServer.ts'
import { belteLog } from '../shared/belteLog.ts'
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
  - nothing recorded → the baked/shell BELTE_APP_URL default, else undefined
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
            belteLog.warn(
                `could not start local instance: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
        }
    }
    if (last?.kind === 'url') {
        const identity = await probeBelteServer(last.url)
        if (identity) {
            return { url: last.url, token: process.env.BELTE_APP_TOKEN, name: identity.name }
        }
        belteLog.warn(`last server at ${last.url} is not responding`)
        return undefined
    }
    // Nothing recorded — fall back to the baked default / shell override.
    const appUrl = process.env.BELTE_APP_URL
    return appUrl ? { url: appUrl, token: process.env.BELTE_APP_TOKEN } : undefined
}
