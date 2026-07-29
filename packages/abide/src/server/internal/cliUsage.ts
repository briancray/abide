// cliUsage(name, commands, command?) — the help text a compiled binary prints.
//
// Generated from the same projection that dispatches (`cliCommands`), so help can never drift from what
// the binary actually accepts: a flag exists in the help exactly when the parser knows it. With a
// `command` it is that subcommand's flag list; without, the program overview.

import type { CliCommand } from './cliCommands.ts'
import { RESERVED_CLI_COMMANDS } from './RESERVED_CLI_COMMANDS.ts'

// The reserved names, listed in help alongside the app's own — read off the one table rather than
// restated, so help lists exactly what the dispatcher and the REPL intercept. They WIN over an rpc of
// the same name; see `RESERVED_CLI_COMMANDS` for why.
// The grammar comes off the table's `flags`/`args` rather than out of the description prose, so a
// spelling the parser accepts cannot be one help never mentions — which is what `-f`, `-n` and
// `--channel` on `logs` were.
const BUILT_INS: [string, string][] = Object.entries(RESERVED_CLI_COMMANDS).map(([name, entry]) => {
    const grammar: string[] = []
    if ('args' in entry && entry.args !== undefined) grammar.push(entry.args)
    if ('flags' in entry && entry.flags !== undefined) grammar.push(...entry.flags)
    return [grammar.length === 0 ? name : `${name} ${grammar.join(' ')}`, entry.description]
})

const OPTIONS: [string, string][] = [
    ['--url <origin>', 'target a deployment for THIS run (over ABIDE_APP_URL, over `connect`)'],
    ['--token <token>', 'bearer for THIS run (over ABIDE_APP_TOKEN, over `connect --token`)'],
    ['--args <json>', 'pass the whole args object as JSON (flags still override fields)'],
    [
        '--pretty / --compact',
        'JSON output shape (default: pretty on a TTY, compact through a pipe)',
    ],
    ['-h, --help', 'show this help'],
]

function column(left: string, right: string | undefined, width: number): string {
    if (right === undefined || right === '') return `  ${left}`
    return `  ${left.padEnd(width)}  ${right}`
}

function flagLine(command: CliCommand): string[] {
    if (command.fields.length === 0) {
        return command.schemaKnown
            ? ['  (takes no arguments)']
            : [
                  '  (no input schema is baked into this binary — flags pass through as typed JSON;',
                  `   the server validates them. \`--args '<json>'\` sends the object verbatim.)`,
              ]
    }
    const width = Math.max(...command.fields.map((field) => field.name.length + 3))
    return command.fields.map((field) => {
        const type = field.type ?? 'value'
        const detail = [
            type === 'boolean' ? 'flag' : `<${type}>`,
            field.required ? 'required' : 'optional',
            field.enum === undefined ? undefined : `one of ${field.enum.map(String).join(', ')}`,
            // Spelled out here rather than compressed into the placeholder: `help` has the width for
            // a sentence, and this is the column someone reads when they are deciding whether they
            // need the flag at all.
            field.default === undefined ? undefined : `default ${String(field.default)}`,
            field.description,
        ]
            .filter((part) => part !== undefined)
            .join(' · ')
        return column(`--${field.name}`, detail, width)
    })
}

export function cliUsage(name: string, commands: CliCommand[], command?: CliCommand): string {
    if (command !== undefined) {
        const lines = [`${name} ${command.name} — ${command.method} /__abide/rpc/${command.name}`]
        if (command.doc !== undefined) lines.push('', command.doc)
        lines.push('', 'Flags:', ...flagLine(command))
        return lines.join('\n')
    }

    const names = [...commands.map((entry) => entry.name), ...BUILT_INS.map(([built]) => built)]
    const width = Math.max(8, ...names.map((entry) => entry.length))

    const lines = [
        `${name} — the app as a command-line tool`,
        '',
        'Usage:',
        `  ${name} <command> [--flag value ...]`,
        `  ${name}                        interactive mode (schema-driven prompts)`,
        '',
        'Commands:',
    ]
    if (commands.length === 0) {
        lines.push('  (this app exposes no clients.cli rpcs)')
    } else {
        for (const entry of commands) {
            lines.push(
                column(entry.name, `${entry.method}${entry.doc ? ` — ${entry.doc}` : ''}`, width),
            )
        }
    }
    lines.push('', 'Reserved:')
    for (const [built, description] of BUILT_INS) lines.push(column(built, description, width))
    lines.push('', 'Options:')
    const optionWidth = Math.max(...OPTIONS.map(([flag]) => flag.length))
    for (const [flag, description] of OPTIONS) lines.push(column(flag, description, optionWidth))
    return lines.join('\n')
}
