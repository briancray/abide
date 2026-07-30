// banner(command, rows, notes) — what an `abide <command>` prints when it has finished starting.
//
//     abide dev
//
//     ➜  local     http://localhost:3001
//     ➜  network   http://192.168.1.24:3001
//
//     ready in 412ms · port 3000 was taken · watching src/ · ctrl-c stops
//
// ONE formatter for every command, so `dev`, `start`, `build`, `scaffold`, `check`, `compile` and
// `bundle` cannot drift into seven layouts. They used to each interpolate their own
// `abide <cmd> — <thing>` line, which is why `abide build` once printed `— [object Object]`: nothing
// tied the shape to a place that could be got right once.
//
// Three parts, and the split is what keeps it scannable: the COMMAND (what ran), the ROWS (addresses
// and paths — the things you click, copy or cd into, so they are the only unstyled text and they are
// aligned into a column), and the NOTES (dim, one line, joined by `·` — facts you read once and then
// stop seeing). Anything a caller would grep for belongs in a row, never in a note.
//
// Styling follows `colourEnabled` — NO_COLOR / FORCE_COLOR / is-stdout-a-terminal, the same ladder
// the REPL banner and the log lines use, so there is no third abide-specific name to learn. A pipe
// gets the identical text with no escapes to strip, and no `➜`: the marker is decoration, and a
// surface that cannot show the colour that makes it read as a marker is better off without the glyph.
// The LAYOUT does not change with colour — an uncoloured banner is still the same lines in the same
// order, because it is also what a bug report pastes.

import { colourEnabled } from '../shared/internal/colourEnabled.ts'
import { painter } from '../shared/internal/painter.ts'
import { networkAddress } from './networkAddress.ts'

export interface BannerRow {
    label: string
    value: string
}

const INDENT = '  '

// Whether THIS process is writing to a terminal. The REPL takes `tty` as an option because it is
// handed a stream it did not open; a CLI command writes to the process's own stdout, so asking it
// directly is the honest question here.
function terminal(): boolean {
    return colourEnabled(process.stdout.isTTY === true)
}

export function banner(command: string, rows: BannerRow[], notes: string[]): string {
    const coloured = terminal()
    const paint = painter(coloured)
    // The marker is two chars wide plus its gap; without it the rows still hang under the command at
    // one indent, so the block reads the same shape either way.
    const marker = coloured ? `${paint.accent('➜')}  ` : ''

    let width = 0
    for (const row of rows) if (row.label.length > width) width = row.label.length

    const lines: string[] = ['', `${INDENT}${paint.bold(command)}`]
    if (rows.length > 0) {
        lines.push('')
        for (const row of rows)
            lines.push(`${INDENT}${marker}${paint.dim(row.label.padEnd(width))}   ${row.value}`)
    }
    if (notes.length > 0) {
        lines.push('')
        lines.push(`${INDENT}${paint.dim(notes.join(' · '))}`)
    }
    return lines.join('\n')
}

// One dim line at the banner's indent — for what a command wants said AFTER work it does between
// printing the banner and finishing (`abide scaffold` runs `git init` and `bun install` in there, so
// its next-step line cannot be a note on a block already written). Same indent as a row, dim like a
// note: it belongs to the block above it, not to whatever printed in between.
export function hint(text: string): string {
    return `${INDENT}${painter(terminal()).dim(text)}`
}

// `412ms` under a second, `1.2s` over it. Rounded on purpose: this number is read to notice that a
// boot got slower, never to measure one.
export function formatDuration(milliseconds: number): string {
    if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
    return `${(milliseconds / 1000).toFixed(1)}s`
}

export interface ServeBannerOptions {
    command: string
    // The bound origin, as the router reports it — the port here is the one actually listening.
    url: string
    // The port that was ASKED for. Present and different from the bound one exactly when the dev
    // lane hopped, which is the one thing about this banner a reader is entitled to an explanation
    // for: you typed 3000 and got 3001.
    requestedPort?: number | undefined
    elapsedMilliseconds: number
    notes?: string[]
}

export function serveBanner(options: ServeBannerOptions): string {
    const port = new URL(options.url).port
    const rows: BannerRow[] = [{ label: 'local', value: options.url }]

    // Omitted rather than shown as `unavailable` when there is no external interface: a row that
    // says nothing still costs a line and a scan, every boot.
    const address = networkAddress()
    if (address !== undefined) rows.push({ label: 'network', value: `http://${address}:${port}` })

    const notes = [`ready in ${formatDuration(options.elapsedMilliseconds)}`]
    if (options.requestedPort !== undefined && String(options.requestedPort) !== port)
        notes.push(`port ${options.requestedPort} was taken`)
    if (options.notes !== undefined) notes.push(...options.notes)
    notes.push('ctrl-c stops')

    return banner(options.command, rows, notes)
}
