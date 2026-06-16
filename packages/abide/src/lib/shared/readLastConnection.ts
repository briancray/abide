import { lastConnectionPath } from './lastConnectionPath.ts'
import type { LastConnection } from './types/LastConnection.ts'

/*
Reads the saved connection intent, or undefined when none is recorded or the file
is unreadable/corrupt — callers treat undefined as "nothing to resume".
*/
export async function readLastConnection(programName: string): Promise<LastConnection | undefined> {
    const file = Bun.file(lastConnectionPath(programName))
    if (!(await file.exists())) {
        return undefined
    }
    try {
        return (await file.json()) as LastConnection
    } catch {
        return undefined
    }
}
