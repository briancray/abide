import { printTrimmed } from './printTrimmed.ts'
import type { CliManifest } from './types/CliManifest.ts'
import type { CliManifestEntry } from './types/CliManifestEntry.ts'

/*
Compact one-line flag signature for the top-level listing: required
flags are shown bare, optional flags wrapped in `[ ]`. Booleans drop the
value placeholder; arrays show `<value...>` to hint repetition. Full
per-flag types + descriptions live in `<cmd> --help`.
*/
function flagSignature(jsonSchema: CliManifestEntry['jsonSchema']): string {
    const properties =
        (jsonSchema?.properties as Record<string, { type?: string }> | undefined) ?? {}
    const required = new Set((jsonSchema?.required as string[] | undefined) ?? [])
    return Object.entries(properties)
        .map(([key, value]) => {
            const placeholder =
                value.type === 'boolean'
                    ? `--${key}`
                    : value.type === 'array'
                      ? `--${key} <value...>`
                      : `--${key} <${value.type ?? 'value'}>`
            return required.has(key) ? placeholder : `[${placeholder}]`
        })
        .join(' ')
}

/*
Top-level help (no subcommand) lists every available command with a one-line
summary. Per-command help lives in `printCommandHelp`. Output goes to stdout;
the caller exits zero after printing.
*/
export function printTopLevelHelp(
    programName: string,
    manifest: CliManifest,
    banner = '',
    footer = '',
): void {
    if (banner.trim()) {
        printTrimmed(banner)
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
        /*
        Summary line favours the schema's top-level description (carried
        through by the vendor's JSON Schema conversion); falls back to
        `method url` when the schema has none. The detail line below
        always shows the args, plus method/url when it isn't already the
        summary.
        */
        const description = entry.jsonSchema?.description as string | undefined
        console.log(`  ${name.padEnd(20)} ${description ?? `${entry.method} ${entry.url}`}`)
        const signature = flagSignature(entry.jsonSchema)
        const detail = [description && `${entry.method} ${entry.url}`, signature]
            .filter(Boolean)
            .join('  ')
        if (detail) {
            console.log(`  ${' '.repeat(20)} ${detail}`)
        }
    }
    console.log(`\nconnection (\`/\` manages the connection, a bare word runs a command):`)
    console.log(`  ${programName} /connect <url>   connect to a remote server`)
    console.log(`  ${programName} /start           start a local instance`)
    console.log(`  ${programName} /disconnect      forget the saved connection`)
    console.log(`  ${programName}                  resume the saved connection (session)`)
    console.log(`\n  --help, -h           show this help`)
    console.log(`  <command> --help     show help for a specific command`)
    console.log(`\nenv:`)
    console.log(`  ABIDE_APP_URL        default server URL (baked at install; shell-overridable)`)
    console.log(`  ABIDE_APP_TOKEN      sent as Authorization: Bearer <value>`)
    if (footer.trim()) {
        console.log('')
        printTrimmed(footer)
    }
}
