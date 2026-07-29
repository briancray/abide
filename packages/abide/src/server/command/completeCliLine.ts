import type { CliCommand } from './cliCommands.ts'
import { RESERVED_CLI_COMMANDS } from './RESERVED_CLI_COMMANDS.ts'
import { tokenizeCliLine } from './tokenizeCliLine.ts'

// completeCliLine(input) — the candidates for a partly-typed command line.
//
// ONE implementation, two callers, because they must agree: the REPL's readline completer and the
// shell-completion callback the `completion` subcommand installs. A shell that offered different
// candidates from the prompt would be worse than no completion — you would learn a flag spelling in
// one place that does not exist in the other.
//
// Everything it knows comes from the same place the interactive prompt's field-filling does: the
// app's own input schemas (`cliCommands`). That is the point — the app already describes its inputs,
// so nobody should have to know the flag spelling, and nobody should have to maintain a completion
// list beside the handlers.
export interface CliCompletion {
    // What to offer.
    candidates: string[]
    // The partial word being replaced — readline needs it back to know what it is substituting, and
    // the shell scripts filter on it.
    partial: string
    // A DISPLAY-ONLY signature for this position, shown when nothing specific is being completed
    // (`rpcGreet ` with the flags still unnamed). Never inserted and never accepted — it answers
    // "what does this command take?", which a bare list of flag names does not: `--name` alone does
    // not say it wants a string, and that is exactly what you are stuck on at that point.
    // Shells ignore it; they have no place to render a non-candidate.
    hint?: string
}

// `--args` is deliberately NOT offered. It is the whole-object escape hatch — present on every
// command, so it sorts first and became the default suggestion for every bare `--`, which is the one
// flag you are never reaching for while typing flags. It still WORKS when spelled in full, and `help`
// still documents it; it is just not what completion volunteers.
function flagsFor(command: CliCommand): string[] {
    const flags: string[] = []
    for (const field of command.fields) {
        flags.push(`--${field.name}`)
        // A boolean is a presence flag with a negative spelling; offering only `--loud` would hide
        // half of what the parser accepts.
        if (field.type === 'boolean') flags.push(`--no-${field.name}`)
    }
    return flags
}

// `--name <string>`, `--colour <red|green|blue>`, `--loud` — what the flag takes, in the same terms
// the schema states it. A boolean carries no placeholder because it takes no value; an enum shows the
// closed set rather than the word "string", because the set IS the type at that point.
function signatureOf(field: CliCommand['fields'][number]): string {
    if (field.type === 'boolean') {
        // A presence flag takes no value, so a default can only be shown as which way it already
        // leans — `--loud=false` reads as "off unless you say otherwise".
        return field.default === undefined
            ? `--${field.name}`
            : `--${field.name}=${String(field.default)}`
    }
    const placeholder =
        field.enum === undefined ? (field.type ?? 'value') : field.enum.map(String).join('|')
    // `<string=hello>` rather than a trailing `(default: hello)`: it keeps the default INSIDE the
    // placeholder it belongs to, so a signature with several flags stays one scannable line.
    const fallback = field.default === undefined ? '' : `=${String(field.default)}`
    return `--${field.name} <${placeholder}${fallback}>`
}

// The field a `--flag` (or `--flag=`) names, if the schema declares it.
function fieldFor(command: CliCommand, token: string): CliCommand['fields'][number] | undefined {
    if (!token.startsWith('--')) return undefined
    const equals = token.indexOf('=')
    const name = (equals === -1 ? token : token.slice(0, equals)).slice(2)
    return command.fields.find((field) => field.name === name)
}

export function completeCliLine(input: {
    // The line up to the CURSOR, not the whole line — completing mid-line must not be driven by what
    // comes after the cursor.
    line: string
    commands: CliCommand[]
    // Which reserved names are live here. The prompt intercepts `exit`/`quit`; a command line does
    // not, so offering them there would advertise something that falls through to the rpc table.
    surface: 'prompt' | 'command'
}): CliCompletion {
    const { line, commands, surface } = input
    const tokens = tokenizeCliLine(line)
    // A trailing space means the current word is empty and a NEW one is starting; otherwise the last
    // token is the partial being completed.
    const startingNewWord = line.length === 0 || /\s$/.test(line)
    const partial = startingNewWord ? '' : (tokens[tokens.length - 1] ?? '')
    const preceding = startingNewWord ? tokens : tokens.slice(0, -1)

    const offer = (all: string[]): CliCompletion => ({
        candidates: all.filter((candidate) => candidate.startsWith(partial)).sort(),
        partial,
    })

    // First word: every rpc the app exposes, plus the names the binary keeps for itself.
    if (preceding.length === 0) {
        const reserved = Object.entries(RESERVED_CLI_COMMANDS)
            .filter(([, entry]) => surface === 'prompt' || entry.where === 'both')
            .map(([name]) => name)
        return offer([...commands.map((command) => command.name), ...reserved])
    }

    const head = preceding[0]
    // `help <TAB>` takes a command name — the one reserved word whose argument is itself a command.
    if (head === 'help') {
        return offer(commands.map((command) => command.name))
    }
    const command = commands.find((candidate) => candidate.name === head)
    // A reserved command's own arguments (`connect <url>`, `login --token <t>`, `serve --port <n>`)
    // are values, not names — there is nothing to enumerate, so offering the app's flags there would
    // be actively wrong.
    if (command === undefined) {
        // A reserved command's flags come off the ONE table, not a hardcoded list here. This used to
        // name `serve` and `login` and nothing else, so `logs` — which has more flags than any other
        // command on either surface — offered none of them.
        const entry = RESERVED_CLI_COMMANDS[head as keyof typeof RESERVED_CLI_COMMANDS]
        const flags = entry !== undefined && 'flags' in entry ? entry.flags : undefined
        if (flags !== undefined) return offer([...flags])
        return { candidates: [], partial }
    }

    // Immediately after `--field`, the shell wants that field's VALUE.
    const previous = preceding[preceding.length - 1]
    if (previous !== undefined && !partial.startsWith('--')) {
        const field = fieldFor(command, previous)
        // A closed set in the schema is a closed set at the prompt — the payoff of the schema being
        // the parser.
        if (field?.enum !== undefined) return offer(field.enum.map(String))
        // A boolean is a PRESENCE flag, so the next word really is another flag. Any other declared
        // field is expecting a value nothing can enumerate, and offering flags there would suggest
        // the value is optional when the parser will read the next token as one.
        if (field !== undefined && field.type !== 'boolean') return { candidates: [], partial }
    }

    // Anything else that starts a word is a flag. A free value has nothing to enumerate.
    if (partial.startsWith('--') || startingNewWord) {
        const used = new Set(preceding.filter((token) => token.startsWith('--')))
        // Don't re-offer a flag already on the line — except the array-typed ones, which are legal
        // repeated (`--tag a --tag b` appends).
        const unused = (name: string): boolean =>
            !used.has(name) || fieldFor(command, name)?.type === 'array'
        const completion = offer(flagsFor(command).filter(unused))
        // With nothing typed yet, the useful answer is the whole SIGNATURE rather than a first
        // candidate picked alphabetically — at that point you are asking what the command takes, not
        // which of several known flags to finish.
        if (partial.length === 0) {
            const remaining = command.fields
                .filter((field) => unused(`--${field.name}`))
                .map(signatureOf)
            if (remaining.length > 0) completion.hint = remaining.join(' ')
        }
        return completion
    }
    return { candidates: [], partial }
}
