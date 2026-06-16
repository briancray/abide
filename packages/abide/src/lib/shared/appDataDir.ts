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

`ABIDE_DATA_DIR` overrides the lot on every platform, used as-is (no programName
appended) — a cross-platform `XDG_DATA_HOME` that also works on macOS/Windows. Set
it to point dev at a throwaway dir without touching app code; leave it unset in
prod for the platform default. A relative value reintroduces cwd-dependence, so a
launched `.app` (cwd `/`) needs an absolute path. Must come from a layer above the
data-dir `.env` (shell, CWD `.env`, or binary-dir `.env`) — it can't be read from
the very file whose location it decides.
*/
export function appDataDir(programName: string): string {
    const override = process.env.ABIDE_DATA_DIR
    if (override !== undefined && override !== '') {
        return override
    }
    const home = homedir()
    if (process.platform === 'darwin') {
        return join(home, 'Library', 'Application Support', programName)
    }
    if (process.platform === 'win32') {
        return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), programName)
    }
    return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), programName)
}
