import { rm } from 'node:fs/promises'
import { lastConnectionPath } from './lastConnectionPath.ts'

// Forgets the saved connection (the `/disconnect` reset). Missing file is a no-op.
export async function clearLastConnection(programName: string): Promise<void> {
    await rm(lastConnectionPath(programName), { force: true })
}
