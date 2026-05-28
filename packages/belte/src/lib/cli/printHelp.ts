import type { CliManifest } from './types/CliManifest.ts'

/*
Top-level help (no subcommand) lists every available command with a
one-line summary. Per-command help (`<cmd> --help`) prints the flags
derived from the command's JSON Schema. Output goes to stdout in both
cases; the caller exits zero after printing.
*/
export function printTopLevelHelp(
    programName: string,
    manifest: CliManifest,
    banner = '',
    footer = '',
): void {
    if (banner.trim()) {
        console.log(banner.replace(/\n$/, ''))
        console.log('')
    }
    const names = Object.keys(manifest).toSorted()
    console.log(`usage: ${programName} <command> [--flags]\n`)
    console.log('commands:')
    for (const name of names) {
        const entry = manifest[name]
        if (!entry) {
            continue
        }
        console.log(`  ${name.padEnd(20)} ${entry.method} ${entry.url}`)
    }
    console.log(`\n  --help, -h           show this help`)
    console.log(`  <command> --help     show help for a specific command`)
    console.log(`\nenv:`)
    console.log(`  APP_URL              remote server URL (unset → in-process)`)
    console.log(`  APP_TOKEN            sent as Authorization: Bearer <value>`)
    if (footer.trim()) {
        console.log('')
        console.log(footer.replace(/\n$/, ''))
    }
}

export function printCommandHelp(programName: string, name: string, manifest: CliManifest): void {
    const entry = manifest[name]
    if (!entry) {
        console.log(`unknown command: ${name}`)
        return
    }
    console.log(`usage: ${programName} ${name} [--flags]\n`)
    console.log(`  ${entry.method} ${entry.url}\n`)
    const schema = entry.jsonSchema
    const properties =
        (schema?.properties as
            | Record<string, { type?: string; description?: string }>
            | undefined) ?? {}
    const required = new Set((schema?.required as string[] | undefined) ?? [])
    if (Object.keys(properties).length === 0) {
        console.log('flags: (none)')
    } else {
        console.log('flags:')
        for (const [key, value] of Object.entries(properties)) {
            const tag =
                value.type === 'boolean'
                    ? `--${key} / --no-${key}`
                    : `--${key} <${value.type ?? 'value'}>`
            const requiredTag = required.has(key) ? ' (required)' : ''
            const description = value.description ? ` — ${value.description}` : ''
            console.log(`  ${tag.padEnd(28)}${requiredTag}${description}`)
        }
    }
    console.log('\n  --json <object>          full args bag as JSON (overrides flags)')
    console.log('  (stdin)                  pipe a JSON object as the args bag')
}
