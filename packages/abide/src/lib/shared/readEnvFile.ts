import { existsSync } from 'node:fs'
import { parseEnv } from './parseEnv.ts'

/*
Reads a `.env` at `path` into a key→value record, or {} when it doesn't exist.
The shared read-and-parse primitive: loadEnvFile builds on it to merge into
process.env, and the bundle launcher uses the record directly to resolve config
form pre-fills.
*/
export async function readEnvFile(path: string): Promise<Record<string, string>> {
    if (!existsSync(path)) {
        return {}
    }
    return parseEnv(await Bun.file(path).text())
}
