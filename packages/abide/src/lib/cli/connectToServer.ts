import { probeAbideServer } from '../bundle/probeAbideServer.ts'
import { abideLog } from '../shared/abideLog.ts'
import { writeLastConnection } from '../shared/writeLastConnection.ts'
import type { CliTarget } from './types/CliTarget.ts'

/*
Connects to a remote abide server: probes its identity endpoint first so we never
record or talk to a non-abide URL, then persists the intent so the next bare run
resumes here. Carries the env bearer token (baked or shell) for authed servers.
Returns the target, or undefined when nothing abide answers.
*/
export async function connectToServer(
    programName: string,
    url: string,
): Promise<CliTarget | undefined> {
    const identity = await probeAbideServer(url)
    if (!identity) {
        abideLog.warn(`no abide server responded at ${url}`)
        return undefined
    }
    await writeLastConnection(programName, { kind: 'url', url })
    return { url, token: process.env.ABIDE_APP_TOKEN, name: identity.name }
}
