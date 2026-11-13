// REGISTRY, READ AS ROWS: every table row of docs/REGISTRY.md with the headings it sits under. A
// page carries the rows of the REGISTRY section its `SITE` entry names (40.43), read as it renders
// (40.47), so the rows a page shows are always REGISTRY's own.

import { cellsOf } from './cellsOf.ts'

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
}

/** Every table row below REGISTRY's preamble, in order. */
export function registryRows(registry: string): RegistryRow[] {
    const rows: RegistryRow[] = []
    let group = ''
    let section = ''
    let subsection: string | undefined
    let header: string[] | undefined
    let table = -1
    let fenced = false
    for (const line of registry.split('\n')) {
        if (line.startsWith('```')) fenced = !fenced
        if (fenced) continue
        if (line.startsWith('# ')) {
            group = section = line.slice(2).trim()
            if (group === 'Registry') group = ''
            subsection = undefined
            header = undefined
            continue
        }
        if (group === '') continue
        if (line.startsWith('## ')) {
            section = line.slice(3).trim()
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
        })
    }
    return rows
}

/** One heading on a page, and the REGISTRY tables under it. */
export type RegistrySection = {
    heading: string
    tables: { header: string[]; rows: RegistryRow[] }[]
}

/** The rows of the REGISTRY section headed `registry`, under the `###` headings they sit under. */
export function sectionsOf(
    rows: readonly RegistryRow[],
    registry: string,
): RegistrySection[] {
    const sections: RegistrySection[] = []
    for (const row of rows) {
        if (row.section !== registry) continue
        let section = sections.find((one) => one.heading === row.heading)
        if (section === undefined) {
            section = { heading: row.heading, tables: [] }
            sections.push(section)
        }
        const table = section.tables.at(-1)
        if (table?.rows.at(-1)?.table === row.table) table.rows.push(row)
        else section.tables.push({ header: row.header, rows: [row] })
    }
    return sections
}
