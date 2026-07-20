// appDataDir() — the per-user application data directory abide reads/writes on behalf of an app
// (desktop bundle state, CLI install marker, local caches). `ABIDE_DATA_DIR` overrides it outright;
// otherwise it resolves to the platform's conventional per-user data location (macOS
// `~/Library/Application Support`, Windows `%APPDATA%`, XDG `~/.local/share` elsewhere), under an
// `abide` subdirectory. The directory is created (recursively) if missing, so a caller can write to
// it immediately. Server-only (filesystem + OS paths).

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function baseDir(): string {
    const override = Bun.env.ABIDE_DATA_DIR
    if (override !== undefined && override.length > 0) return override

    const home = homedir()
    if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'abide')
    if (process.platform === 'win32') {
        const appData = Bun.env.APPDATA
        return join(
            appData !== undefined && appData.length > 0
                ? appData
                : join(home, 'AppData', 'Roaming'),
            'abide',
        )
    }
    const xdg = Bun.env.XDG_DATA_HOME
    return join(xdg !== undefined && xdg.length > 0 ? xdg : join(home, '.local', 'share'), 'abide')
}

export function appDataDir(): string {
    const dir = baseDir()
    mkdirSync(dir, { recursive: true })
    return dir
}
