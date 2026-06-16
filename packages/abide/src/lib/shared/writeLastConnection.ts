import { mkdir } from 'node:fs/promises'
import { appDataDir } from './appDataDir.ts'
import { lastConnectionPath } from './lastConnectionPath.ts'
import type { LastConnection } from './types/LastConnection.ts'

// Persists the connection intent, creating the data dir on first write.
export async function writeLastConnection(
    programName: string,
    value: LastConnection,
): Promise<void> {
    await mkdir(appDataDir(programName), { recursive: true })
    await Bun.write(lastConnectionPath(programName), JSON.stringify(value))
}
