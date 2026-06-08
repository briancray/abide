import type { Pages } from '../../browser/types/Pages.ts'
import { log } from '../../shared/log.ts'
import type { NormalizedLayoutPrefix } from '../../shared/nearestLayoutPrefix.ts'
import { nearestLayoutPrefix } from '../../shared/nearestLayoutPrefix.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import { ensureRegistriesLoaded } from './registryManifests.ts'

// Cell glyphs: PRESENT, ABSENT.
const PRESENT = '✓'
const ABSENT = '·'
const COLUMN_GAP = 2

const hasColor = typeof Bun !== 'undefined' && Bun.enableANSIColors
// Red foreground then `\x1b[39m` (default-foreground, not full reset) so the enclosing dim survives.
const redden = (text: string): string =>
    hasColor ? `${Bun.color('red', 'ansi-256')}${text}\x1b[39m` : text

/*
A declared inputSchema is what makes mcp/cli safe to advertise (see defineVerb /
defineSocket), so a missing schema gets a red `·` to flag the declaration whose
machine surfaces are gated behind it.
*/
const schemaCell = (hasSchema: boolean): string => (hasSchema ? PRESENT : redden(ABSENT))
const flag = (on: boolean): string => (on ? PRESENT : ABSENT)

// Display width ignoring ANSI color escapes, so colored glyphs don't inflate alignment.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the ESC (\x1b) is the intended match — stripping the color escape to measure visible width
const displayWidth = (cell: string): number => cell.replace(/\x1b\[[0-9;]*m/g, '').length

// A titled table: its header row plus data rows, all sharing the column layout below.
type SurfaceTable = { title: string; header: string[]; rows: string[][] }

// Per-column width: the widest cell's display width across every row given.
function columnWidths(rows: string[][]): number[] {
    const columnCount = Math.max(...rows.map((row) => row.length))
    return Array.from({ length: columnCount }, (_, column) =>
        Math.max(...rows.map((row) => displayWidth(row[column] ?? ''))),
    )
}

/*
Left-aligns one row's cells into the given fixed column widths plus a gap.
Padding is explicit spaces measured by displayWidth so embedded color escapes
don't inflate the width and break alignment. Two-space indented.
*/
function renderRow(row: string[], widths: number[]): string {
    return (
        '  ' +
        row
            .map(
                (cell, column) =>
                    cell + ' '.repeat(widths[column] - displayWidth(cell) + COLUMN_GAP),
            )
            .join('')
            .trimEnd()
    )
}

/*
Prints every non-empty table under one shared set of column widths, so the
identifier and glyph columns line up vertically across the page/socket/rpc
tables rather than each table aligning only within itself. Each table keeps its
own dim header row.
*/
function logTables(tables: SurfaceTable[]): void {
    const present = tables.filter((table) => table.rows.length > 0)
    if (present.length === 0) {
        return
    }
    const widths = columnWidths(present.flatMap((table) => [table.header, ...table.rows]))
    present.forEach((table) => {
        log.info(`${table.title}:`)
        log.detail([table.header, ...table.rows].map((row) => renderRow(row, widths)).join('\n'))
    })
}

/*
Boot-time surface map: every page, socket, and rpc with the surfaces it is
exposed on, so belte's routing and multimodal-by-default exposure are auditable
rather than implicit. Three aligned tables — scan a column to spot a missing
surface, a row to see one declaration's reach:

  - pages: each route with the nearest layout and error boundary wrapping it.
  - sockets: name + client surfaces (schema/browser/mcp/cli) and whether clients
    may publish.
  - rpcs: method+path (headed `http` since http/openapi are unconditional) +
    per-declaration client surfaces.

All three render under one shared column grid (see logTables): the identifier
leads flush-left in every table — page route, socket name, or rpc method+path —
then the surface columns, so the glyphs line up vertically across the tables.
rpc folds its method into a left-aligned prefix of the identifier cell, so paths
still start at a shared column. For sockets and rpcs the `schema`
column leads: it's what unlocks the non-browser surfaces, so a missing schema
reddens to flag the gated declaration. Loads the full registry, so it runs once
at boot and only under `belte` debug logging (DEBUG=belte) to avoid forcing
eager imports in production. Best-effort: enumeration failures are swallowed,
this is diagnostic only.
*/
export async function logExposedSurfaces(routing: {
    pages: Pages
    layoutPrefixes: NormalizedLayoutPrefix[]
    errorPrefixes: NormalizedLayoutPrefix[]
}): Promise<void> {
    try {
        await ensureRegistriesLoaded()
    } catch {
        return
    }

    const pageRows = Object.keys(routing.pages)
        .map((route) => [
            route,
            nearestLayoutPrefix(route, routing.layoutPrefixes) ?? ABSENT,
            nearestLayoutPrefix(route, routing.errorPrefixes) ?? ABSENT,
        ])
        .sort()

    const socketRows = Array.from(socketRegistry.values(), (entry) => [
        entry.socket.name,
        schemaCell(Boolean(entry.schema)),
        flag(entry.clients.browser),
        flag(entry.clients.mcp),
        flag(entry.clients.cli),
        flag(entry.allowClientPublish),
    ]).sort()

    /*
    rpc identifier = method left-aligned to a shared width then the path, so the
    methods line up and every path starts at the same column — while the cell as
    a whole still leads flush-left like the page route and socket name.
    */
    const methodWidth = Math.max(
        'http'.length,
        ...Array.from(verbRegistry.values(), (entry) => entry.remote.method.length),
    )
    const withMethod = (method: string, identifier: string): string =>
        method.padEnd(methodWidth + COLUMN_GAP) + identifier

    const rpcRows = Array.from(verbRegistry.values(), (entry) => [
        withMethod(entry.remote.method, entry.remote.url),
        schemaCell(Boolean(entry.inputSchema)),
        flag(entry.clients.browser),
        flag(entry.clients.mcp),
        flag(entry.clients.cli),
    ]).sort()

    logTables([
        { title: 'pages', header: ['page', 'layout', 'error'], rows: pageRows },
        {
            title: 'sockets',
            header: ['socket', 'schema', 'browser', 'mcp', 'cli', 'publish'],
            rows: socketRows,
        },
        {
            title: 'rpcs',
            header: [withMethod('http', ''), 'schema', 'browser', 'mcp', 'cli'],
            rows: rpcRows,
        },
    ])
}
