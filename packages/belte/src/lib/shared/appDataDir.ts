import { homedir } from 'node:os'
import { join } from 'node:path'

/*
Platform-standard per-user data directory for a bundle, keyed by its program
name. cwd-independent on purpose: the path derives from `programName`, not the
process working directory — which the OS `open` command sets to `/`, so anything
relying on cwd (Bun's `.env` autoload, relative paths) finds nothing inside a
launched `.app`. This is where a bundle keeps what can't be baked at compile time
— the user's config, DB, and cache. macOS Application Support, Windows %APPDATA%,
XDG data home elsewhere. Pure: computes the path, never touches the filesystem.
*/
export function appDataDir(programName: string): string {
    const home = homedir()
    if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', programName)
    }
    if (process.platform === 'win32') {
        return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), programName)
    }
    return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), programName)
}
