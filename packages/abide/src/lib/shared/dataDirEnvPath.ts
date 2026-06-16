import { join } from 'node:path'
import { appDataDir } from './appDataDir.ts'

/*
The user's `.env` in the program's per-user data dir — the cwd-independent
config layer the connect-screen form writes and the server loads first at
boot. One statement of the location so the writer (controlServerWorker), the
boot loader (loadEnvFromDataDir), and the embedded-port resolver can't drift.
*/
export function dataDirEnvPath(programName: string): string {
    return join(appDataDir(programName), '.env')
}
