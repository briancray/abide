import type { CliManifest } from './types/CliManifest.ts'

/*
Shell-completion candidates for a partially-typed command line, derived
entirely from the baked manifest so completion can't drift from dispatch.
`cword` is the token index being completed (the shell's COMP_CWORD /
CURRENT), `command` is the first positional (`words[1]`). Completing the
first positional lists every command plus the `/`-prefixed connection
verbs; past it, the chosen command's flags (mirroring parseArgvForRpc's
grammar — `--name`, plus `--no-name` for a boolean, and the always-present
`--json`). The shell filters these by the current prefix.
*/
export function completeCli(
    manifest: CliManifest,
    cword: number,
    command: string | undefined,
): string[] {
    // Completing the command itself: every rpc/socket command + the connection verbs.
    if (cword <= 1) {
        const connection = ['/connect', '/start', '/disconnect', '/help', '/completions']
        return [...Object.keys(manifest).toSorted(), ...connection]
    }
    const entry = command === undefined ? undefined : manifest[command]
    if (!entry) {
        return []
    }
    const properties =
        (entry.jsonSchema?.properties as Record<string, { type?: string }> | undefined) ?? {}
    const flags = ['--json']
    for (const [key, value] of Object.entries(properties)) {
        flags.push(`--${key}`)
        // A boolean flag also accepts its negation, matching printCommandHelp's `--no-<key>`.
        if (value.type === 'boolean') {
            flags.push(`--no-${key}`)
        }
    }
    return flags
}
