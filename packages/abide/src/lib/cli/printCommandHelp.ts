import type { CliManifest } from './types/CliManifest.ts'

/*
Per-command help (`<cmd> --help`): the command's method/url, its description, and
the flags derived from its JSON Schema. Output goes to stdout; the caller exits
zero after printing. Top-level help (the command listing) lives in
`printTopLevelHelp`.
*/
export function printCommandHelp(programName: string, name: string, manifest: CliManifest): void {
    const entry = manifest[name]
    if (!entry) {
        console.log(`unknown command: ${name}`)
        return
    }
    console.log(`usage: ${programName} ${name} [--flags]\n`)
    console.log(`  ${entry.method} ${entry.url}\n`)
    const schema = entry.jsonSchema
    const commandDescription = schema?.description as string | undefined
    if (commandDescription) {
        console.log(`${commandDescription}\n`)
    }
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
