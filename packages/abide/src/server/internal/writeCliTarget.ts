// Persist (or clear) the deployment this binary is connected to. Omitting `target` disconnects.
//
// Written `0600` because the file may hold a bearer token — a per-user CLI credential in a per-user
// data dir has no business being world-readable. `node:fs` rather than `Bun.write`: the mode has to be
// set AT CREATE (a write-then-chmod leaves a window where the token sits at the default umask), and
// chmod runs after it anyway to fix the perms of a file that already existed.

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { cliTargetPath } from './cliTargetPath.ts'
import type { CliTarget } from './readCliTarget.ts'

const TARGET_FILE_MODE = 0o600

export function writeCliTarget(appName: string, target?: CliTarget): void {
    const path = cliTargetPath(appName)
    if (target === undefined) {
        rmSync(path, { force: true })
        return
    }
    writeFileSync(path, `${JSON.stringify(target, null, 2)}\n`, { mode: TARGET_FILE_MODE })
    chmodSync(path, TARGET_FILE_MODE)
}
