import { probeBelteServer } from '../bundle/probeBelteServer.ts'
import { belteLog } from '../shared/belteLog.ts'
import { writeLastConnection } from '../shared/writeLastConnection.ts'
import type { CliTarget } from './types/CliTarget.ts'

/*
Connects to a remote belte server: probes its identity endpoint first so we never
record or talk to a non-belte URL, then persists the intent so the next bare run
resumes here. Carries the env bearer token (baked or shell) for authed servers.
Returns the target, or undefined when nothing belte answers.
*/
export async function connectToServer(
    programName: string,
    url: string,
): Promise<CliTarget | undefined> {
    const identity = await probeBelteServer(url)
    if (!identity) {
        belteLog.warn(`no belte server responded at ${url}`)
        return undefined
    }
    await writeLastConnection(programName, { kind: 'url', url })
    return { url, token: process.env.BELTE_APP_TOKEN, name: identity.name }
}
