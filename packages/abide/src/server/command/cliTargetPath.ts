// Where a compiled binary remembers the deployment `connect` pointed it at.
//
// Per-USER, not per-directory: the binary is installed once and run from anywhere, so a cwd-relative
// dotfile would forget the target the moment you changed directory. `appDataDir()` is an OS path
// (`~/Library/Application Support/abide`, `%APPDATA%`, XDG), which is exactly why it still resolves
// inside an executable whose own directory is the read-only `/$bunfs/root`.
//
// Keyed by app name so two abide binaries on one machine keep separate targets.

import { join } from 'node:path'
import { appDataDir } from '../appDataDir.ts'

// A package name is not a filename: it may be scoped (`@acme/tools`) or carry anything npm allows.
// Fold everything outside a safe set to `-` so the path stays one flat, predictable file.
function fileSafe(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '-')
}

export function cliTargetPath(appName: string): string {
    return join(appDataDir(), `${fileSafe(appName)}.target.json`)
}
