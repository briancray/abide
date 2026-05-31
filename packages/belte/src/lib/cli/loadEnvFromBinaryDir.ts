import { dirname } from 'node:path'
import { loadEnvFile } from '../shared/loadEnvFile.ts'

/*
Loads a `.env` sitting next to the running binary (resolved via
`process.execPath`) into `process.env`. This is the file the install tarball
ships beside the executable — and, for a bundle, the one `bundleApp` copies
from the project's `.env.bundle`. It carries the app's shipped defaults; the
fill-when-unset merge (see loadEnvFile) lets per-shell exports, Bun's CWD
`.env`, and the user's data-dir config all override it.
*/
export async function loadEnvFromBinaryDir(): Promise<void> {
    await loadEnvFile(`${dirname(process.execPath)}/.env`)
}
