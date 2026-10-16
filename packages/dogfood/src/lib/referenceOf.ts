// THE REFERENCE, READ OFF docs/REGISTRY.md (40.42): every table row, and the one reference page it
// is on (40.43). `scripts/referencePages.ts` runs this over the exports the entry points declare to
// decide which pages there are and writes them down in `REFERENCE.ts`; a reference page runs it again
// over that list as it renders, so the rows a page shows are always REGISTRY's own.
//
// WHICH PAGE A ROW IS ON, first rule that applies:
//
//   a. a table under a `###` heading naming an export is that export's options or members:
//      `### ReactiveOptions`. A row in it naming an export with no other row is that export's own
//      (`structural`); one naming an export written down elsewhere is the option (`middleware`).
//   b. a row naming exports is on their page: `reactive`, `Failed<Name, Data>`. A row naming
//      several (`POST` / `PUT` / …) makes them one page.
//   c. a member is on its receiver's page: `log.named`, `App[Symbol.asyncDispose]`. REGISTRY spells
//      an instance with a receiver letter, and `RECEIVERS` names the type each one stands for.
//   d. a name the signature of an export in the same `##` section declares, as a type parameter or a
//      field, is on that export's page: `Accepted` on `Reactive`, `version` on `Health`.
//   e. any other row is on the page most of its table's rows are on: `for await (… of s)` with
//      `s.then`, `clients` with `Clients`.
//   f. a table no export claims is on its `#` group's page: the CLI, the files, the template syntax.
//
// Only a `Name` column names an export or a member, so b, c and d read no other: a Spelling, a Path,
// a File, a Header or a Command is written in place, and `health.ts` is a file rather than a member.
//
// An export's SCOPE is where REGISTRY writes it: a section whose heading names an
// `@abide/harness/…` entry holds that entry's names, and every other section holds abide's —
// which is how `bytes` the response helper and `bytes` the harness lane are two pages.

/** One reference page, as `REFERENCE.ts` lists it. */
export type ReferencePage = {
    route: string
    /** The exports on it, empty for a `#` group's page. */
    names: readonly string[]
    /** The entry point they are imported from. */
    entry: string | undefined
    /** The REGISTRY `#` group it is listed under. */
    group: string
    /** Whether the names are imported with `import type`. */
    typeOnly: boolean
}

/** One REGISTRY table row, with the headings it sits under. */
export type RegistryRow = {
    /** The row's cells, `\|` unescaped. */
    cells: string[]
    /** The header cells of its table. */
    header: string[]
    /** Its table, counted from the top of REGISTRY. */
    table: number
    group: string
    /** The `##` heading, or the group where there is none. */
    section: string
    /** The nearest heading: what the row is listed under on its page. */
    heading: string
    /** The `###` heading, where the row is under one. */
    subsection: string | undefined
    /** How a guide's `covers` qualifies the name: the `##` heading's first code span, or the heading. */
    qualifier: string
    /** `abide`, or the `@abide/harness/…` entry the `##` heading names. */
    scope: string
}

/** Where a row is: an export's page by its scope and name, or a group's page. */
export type Placement =
    | { kind: 'export'; scope: string; name: string }
    | { kind: 'group'; group: string }

const RECEIVERS = new Map([
    ['s', 'Reactive'],
    ['k', 'Keyed'],
    ['rpc', 'Rpc'],
])
const IDENTIFIER = /^([A-Za-z_$][\w$]*)(<.*>)?$/
const RECEIVER = /^([A-Za-z_$][\w$]*)[.[]/

function firstCode(text: string): string | undefined {
    return /`([^`]+)`/.exec(text)?.[1]
}

/** A table row's cells — a cell ends at the first UNESCAPED pipe, a signature carrying `\|`. */
export function cellsOf(line: string): string[] {
    const out: string[] = []
    let start = 1
    for (let at = 1; at <= line.length; at += 1) {
        if (at < line.length && !(line[at] === '|' && line[at - 1] !== '\\'))
            continue
        out.push(line.slice(start, at).trim().replaceAll('\\|', '|'))
        start = at + 1
    }
    return out.slice(0, -1)
}

/** The scope an entry's names are written in. */
export function scopeOf(entry: string): string {
    return entry.startsWith('@abide/abide') ? 'abide' : entry
}

const FENCES = new Set(['server', 'public', 'lib', 'tests'])

/**
 * A reference page's file, from the docs app's root: an `index.abide` in a directory named for it,
 * or a file named for it where that name is a fence and a directory of it would have no address —
 * `server` the ambient value is `src/reference/server.abide`.
 */
export function referenceFileOf(route: string): string {
    return FENCES.has(route.slice(route.lastIndexOf('/') + 1))
        ? `src${route}.abide`
        : `src${route}/index.abide`
}

/** Every table row below REGISTRY's preamble, in order. */
export function registryRows(registry: string): RegistryRow[] {
    const rows: RegistryRow[] = []
    let group = ''
    let section = ''
    let subsection: string | undefined
    let qualifier = ''
    let scope = 'abide'
    let header: string[] | undefined
    let table = -1
    let fenced = false
    for (const line of registry.split('\n')) {
        if (line.startsWith('```')) fenced = !fenced
        if (fenced) continue
        if (line.startsWith('# ')) {
            group = section = qualifier = line.slice(2).trim()
            if (group === 'Registry') group = ''
            subsection = undefined
            scope = 'abide'
            header = undefined
            continue
        }
        if (group === '') continue
        if (line.startsWith('## ')) {
            section = line.slice(3).trim()
            const code = firstCode(section)
            qualifier = code ?? section
            scope = code?.startsWith('@abide/') ? code : 'abide'
            subsection = undefined
            header = undefined
            continue
        }
        if (line.startsWith('### ')) {
            subsection = line.slice(4).trim()
            header = undefined
            continue
        }
        if (!line.startsWith('|')) {
            header = undefined
            continue
        }
        if (/^\|\s*---/.test(line)) continue
        if (header === undefined) {
            header = cellsOf(line)
            table += 1
            continue
        }
        rows.push({
            cells: cellsOf(line),
            header,
            table,
            group,
            section,
            heading: subsection ?? section,
            subsection,
            qualifier,
            scope,
        })
    }
    return rows
}

// The exports a row names, where its first cell is nothing but names: `reactive`, `Failed<Name,
// Data>`, `POST` / `PUT` / `PATCH` / `DELETE`.
function namedBy(row: RegistryRow, exported: Set<string>): string[] {
    const cell = row.cells[0] ?? ''
    if (row.header[0] !== 'Name' || !/^`[^`]+`( \/ `[^`]+`)*$/.test(cell))
        return []
    const names: string[] = []
    for (const [, span] of cell.matchAll(/`([^`]+)`/g)) {
        const name = IDENTIFIER.exec(span as string)?.[1]
        if (name === undefined || !exported.has(`${row.scope}\0${name}`))
            return []
        names.push(name)
    }
    return names
}

// The type parameters a signature opens on, and the fields it declares.
function declares(signature: string, own: string, name: string): boolean {
    const bare = signature.replace(/^`|`$/g, '')
    const open = bare.startsWith('<')
        ? 0
        : bare.startsWith(`${own}<`)
          ? own.length
          : -1
    if (open !== -1) {
        let depth = 0
        let parameter = ''
        for (let at = open; at < bare.length; at += 1) {
            const character = bare[at] as string
            if (character === '<' || character === '(' || character === '{')
                depth += 1
            if (character === '>' || character === ')' || character === '}')
                depth -= 1
            if (depth === 0 || (depth === 1 && character === ',')) {
                if (/^\s*([A-Za-z_$][\w$]*)/.exec(parameter)?.[1] === name)
                    return true
                parameter = ''
                if (depth === 0) break
                continue
            }
            if (!(depth === 1 && at === open)) parameter += character
        }
    }
    return new RegExp(`[{;,]\\s*${name}\\??\\s*:`).test(bare)
}

/**
 * Where each row is, given every export as `scope` and `name`. A row naming several exports is
 * placed on the first; `aliases` maps each other to it.
 */
export function placementsOf(
    rows: readonly RegistryRow[],
    exports: Iterable<{ scope: string; name: string }>,
): { placements: Placement[]; aliases: Map<string, string> } {
    const exported = new Set<string>()
    for (const { scope, name } of exports) exported.add(`${scope}\0${name}`)
    const placements: (Placement | undefined)[] = []
    const aliases = new Map<string, string>()
    const ownRows = new Map<string, number>()
    for (const row of rows)
        for (const name of namedBy(row, exported)) {
            const key = `${row.scope}\0${name}`
            ownRows.set(key, (ownRows.get(key) ?? 0) + 1)
        }
    const own = (scope: string, name: string): Placement => {
        const key = aliases.get(`${scope}\0${name}`) ?? name
        return { kind: 'export', scope, name: key }
    }
    // a, b, c
    for (const row of rows) {
        const named = namedBy(row, exported)
        const options = firstCode(row.subsection ?? '')
        const optionsOf =
            options !== undefined && exported.has(`${row.scope}\0${options}`)
                ? options
                : undefined
        if (
            optionsOf !== undefined &&
            !(
                named.length > 0 &&
                ownRows.get(`${row.scope}\0${named[0]}`) === 1
            )
        ) {
            placements.push(own(row.scope, optionsOf))
            continue
        }
        if (named.length > 0) {
            const first = named[0] as string
            for (const other of named.slice(1))
                aliases.set(`${row.scope}\0${other}`, first)
            placements.push(own(row.scope, first))
            continue
        }
        const spelled =
            row.header[0] === 'Name'
                ? (firstCode(row.cells[0] ?? '') ?? '')
                : ''
        const receiver = RECEIVER.exec(spelled)?.[1]
        const instance = RECEIVERS.get(receiver ?? spelled)
        if (
            receiver !== undefined &&
            exported.has(`${row.scope}\0${receiver}`)
        ) {
            placements.push(own(row.scope, receiver))
            continue
        }
        if (
            instance !== undefined &&
            exported.has(`${row.scope}\0${instance}`)
        ) {
            placements.push(own(row.scope, instance))
            continue
        }
        placements.push(undefined)
    }
    // d
    for (let at = 0; at < rows.length; at += 1) {
        if (placements[at] !== undefined) continue
        const row = rows[at] as RegistryRow
        const name = IDENTIFIER.exec(
            /^`([^`]+)`$/.exec(row.cells[0] ?? '')?.[1] ?? '',
        )?.[1]
        if (name === undefined || row.header[0] !== 'Name') continue
        for (let other = 0; other < rows.length; other += 1) {
            const candidate = rows[other] as RegistryRow
            if (candidate.section !== row.section) continue
            const declarer = namedBy(candidate, exported)[0]
            if (
                declarer !== undefined &&
                declares(candidate.cells[1] ?? '', declarer, name)
            ) {
                placements[at] = own(row.scope, declarer)
                break
            }
        }
    }
    // e, f
    const settled = placements.slice()
    for (let at = 0; at < rows.length; at += 1) {
        if (placements[at] !== undefined) continue
        const row = rows[at] as RegistryRow
        const counts = new Map<
            string,
            { placement: Placement; count: number }
        >()
        let best: { placement: Placement; count: number } | undefined
        for (let other = 0; other < rows.length; other += 1) {
            const placement = settled[other]
            if (rows[other]?.table !== row.table || placement === undefined)
                continue
            const key = JSON.stringify(placement)
            const tally = counts.get(key) ?? { placement, count: 0 }
            tally.count += 1
            counts.set(key, tally)
            if (best === undefined || tally.count > best.count) best = tally
        }
        placements[at] = best?.placement ?? { kind: 'group', group: row.group }
    }
    return { placements: placements as Placement[], aliases }
}

/** One heading on a reference page, and the REGISTRY tables under it that are on the page. */
export type ReferenceSection = {
    heading: string
    tables: { header: string[]; rows: RegistryRow[] }[]
}

/** Every reference page's sections, by route, in REGISTRY's order. */
export function referenceSectionsOf(
    registry: string,
    pages: readonly ReferencePage[],
): Map<string, ReferenceSection[]> {
    const rows = registryRows(registry)
    const routeOf = new Map<string, string>()
    const exports: { scope: string; name: string }[] = []
    for (const page of pages) {
        if (page.entry === undefined) {
            routeOf.set(`group\0${page.group}`, page.route)
            continue
        }
        const scope = scopeOf(page.entry)
        for (const name of page.names) {
            exports.push({ scope, name })
            routeOf.set(`${scope}\0${name}`, page.route)
        }
    }
    const { placements } = placementsOf(rows, exports)
    const sections = new Map<string, ReferenceSection[]>()
    for (const [at, row] of rows.entries()) {
        const placement = placements[at] as Placement
        const route =
            routeOf.get(
                placement.kind === 'group'
                    ? `group\0${placement.group}`
                    : `${placement.scope}\0${placement.name}`,
            ) ?? ''
        const onPage = sections.get(route) ?? []
        sections.set(route, onPage)
        let section = onPage.find((one) => one.heading === row.heading)
        if (section === undefined) {
            section = { heading: row.heading, tables: [] }
            onPage.push(section)
        }
        const table = section.tables.at(-1)
        if (table?.rows.at(-1)?.table === row.table) table.rows.push(row)
        else section.tables.push({ header: row.header, rows: [row] })
    }
    return sections
}
