import { spawnEmbeddedServer } from '../bundle/spawnEmbeddedServer.ts'
import { writeLastConnection } from '../shared/writeLastConnection.ts'
import type { CliTarget } from './types/CliTarget.ts'

/*
Boots a local (embedded) instance for this session and records the intent so the
next bare run resumes a local instance. The caller owns the returned child and
reaps it on disconnect/exit. Throws if the server crashes before binding.
*/
export async function startLocalInstance(programName: string): Promise<CliTarget> {
    const { url, child } = await spawnEmbeddedServer({ programName })
    await writeLastConnection(programName, { kind: 'embedded' })
    return { url, child }
}
