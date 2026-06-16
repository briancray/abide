import { dataDirEnvPath } from './dataDirEnvPath.ts'
import { loadEnvFile } from './loadEnvFile.ts'

/*
Loads the user's `.env` from the program's per-user data dir into `process.env`.
This is the cwd-independent config layer — where the connect-screen form writes
the user's answers, and where a bundle launched via `open` (cwd `/`, so Bun's
CWD `.env` autoload finds nothing) actually picks up its config. Loaded before
the binary-dir `.env`, so a user's saved config overrides the shipped default;
still loses to a shell export or a CWD `.env` (fill-when-unset, see loadEnvFile).
*/
export async function loadEnvFromDataDir(programName: string): Promise<void> {
    await loadEnvFile(dataDirEnvPath(programName))
}
