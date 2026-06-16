import { readEnvFile } from './readEnvFile.ts'

/*
Reads a `.env` at `path` and merges each declared var into `process.env`
only when not already set. Fill-when-unset is the precedence rule the whole
env stack relies on: layers loaded earlier (shell/ambient, Bun's CWD `.env`)
win, and later callers back-fill only what's still missing. So a value's
source is invisible to the app — it reads one flat `process.env` (Bun.env is
the same object). Missing file is a no-op.
*/
export async function loadEnvFile(path: string): Promise<void> {
    for (const [key, value] of Object.entries(await readEnvFile(path))) {
        if (process.env[key] === undefined) {
            process.env[key] = value
        }
    }
}
