import { join } from 'node:path'
import { appDataDir } from './appDataDir.ts'

// Path to the per-program last-connection record, beside the data-dir `.env`.
export function lastConnectionPath(programName: string): string {
    return join(appDataDir(programName), 'last-connection.json')
}
