// 51.157-51.165 — A JSON VALUE TO SEARCH AND INSPECT, as parts an app spreads onto elements of its own: a
// search field, and `tree`'s parts over a row per value, each told apart by its JSON Pointer. The rows
// are flat — a row says its depth through `aria-level` — so a large document renders as one list, and
// a search narrows the tree to its matches and what holds them, opened, without writing `expanded`.

import type { JsonValue } from './JsonValue.ts'
import { type LabelRun, labelRuns, needlesOf } from './labelRuns.ts'
import { type Live, live } from './live.ts'
import { madeId } from './madeId.ts'
import { pointerToken } from './pointerToken.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { reactiveOver } from './reactiveOver.ts'
import { tree } from './tree.ts'
import { withPart } from './withPart.ts'

/** What a JSON value is. */
export type JsonKind =
    'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

/** One value in the document: where it is, what it is under, and what it holds. */
export type JsonRow = {
    /** Where it is, as a JSON Pointer: `''` for the root, `/contacts/0/name` below it. */
    readonly pointer: string
    /** The property it is under, or its index in an array; none for the root. */
    readonly key: string | number | undefined
    readonly value: JsonValue
    readonly kind: JsonKind
    /** How many entries an object or an array holds; none for any other value. */
    readonly size: number | undefined
    /** Its depth, the root's `1`. */
    readonly level: number
}

/** The document, what it is searched for, and which rows are expanded and picked. */
export type JsonInspectorOptions = {
    /** The base the ids its parts write are derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** The JSON value inspected; a function is read live. */
    value: Live<JsonValue>
    /** What is searched for, where the app holds it: a `Reactive` to read and set. Held by the parts, blank, and handed back as `query`, where none is given. */
    query?: Reactive<string> | undefined
    /** The pointers of the rows expanded, where the app holds them. Held by the parts, the root expanded, and handed back as `expanded`, where none is given. */
    expanded?: Reactive<readonly string[]> | undefined
    /** The pointer of the row picked, where the app holds it. Held by the parts, and handed back as `selected`, where none is given. */
    selected?: Reactive<string | undefined> | undefined
}

/** One row's parts: its item, its key and value in runs, whether it is expanded, and the toggle. */
export type JsonRowParts = {
    /** `tree`'s item for the row, and whether it matches the search. */
    readonly item: Record<string, unknown>
    /** The key's text in runs, what is searched for carrying the `match` part; none for the root. */
    get keyRuns(): readonly LabelRun[]
    /** A string's, number's, boolean's or null's text in runs, as `keyRuns`; none for an object or an array. */
    get valueRuns(): readonly LabelRun[]
    /** Whether the row is expanded. */
    get expanded(): boolean
    /** Expands the row where it is collapsed, or collapses it where it is expanded. */
    toggle(): void
}

/** The parts `jsonInspector` hands back, each spread onto an element: `<input {...json.search} />`. */
export type JsonInspector = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The search field. */
    readonly search: Record<string, unknown>
    /** `tree`'s tree part. */
    readonly tree: Record<string, unknown>
    /** The rows that show, in order. */
    get rows(): readonly JsonRow[]
    /** One row's parts. */
    row(row: JsonRow): JsonRowParts
    /** Every row matching the search, in the document's order, showing or not. */
    get matches(): readonly JsonRow[]
    /** The row picked, showing or not. */
    get inspected(): JsonRow | undefined
    /** What is searched for, read and set. */
    readonly query: Reactive<string>
    /** The pointers of the rows expanded, read and set. */
    readonly expanded: Reactive<readonly string[]>
    /** The pointer of the row picked, read and set. */
    readonly selected: Reactive<string | undefined>
}

// 49.3 — the part a matched run spreads.
const MATCH = { 'data-json-inspector': 'match' }
const NO_RUNS: readonly LabelRun[] = []
const NO_ROWS: readonly JsonRow[] = []

const kindOf = (value: JsonValue): JsonKind =>
    value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : (typeof value as JsonKind)

const keyText = (row: JsonRow): string =>
    row.key === undefined ? '' : String(row.key)

// A string reads as itself, unquoted; any other value that is not a container as its JSON.
const valueText = (row: JsonRow): string | undefined =>
    row.size !== undefined
        ? undefined
        : typeof row.value === 'string'
          ? row.value
          : JSON.stringify(row.value)

/** A JSON value searched and inspected: a search field and `tree`'s parts over a row per value. */
export function jsonInspector(options: JsonInspectorOptions): JsonInspector {
    const base = options.id ?? madeId('json')
    const query = options.query ?? reactive('')
    const expanded = options.expanded ?? reactive<readonly string[]>([''])
    const selected = options.selected ?? reactive<string | undefined>(undefined)

    // EVERY ROW, and each one's entries: one walk, again only when the value changes.
    const parsed = reactive(() => {
        const rows = new Map<string, JsonRow>()
        const entries = new Map<string, readonly JsonRow[]>()
        const visit = (
            value: JsonValue,
            key: string | number | undefined,
            pointer: string,
            level: number,
        ): JsonRow => {
            const kind = kindOf(value)
            const below: JsonRow[] = []
            if (kind === 'array')
                for (const [index, each] of (value as JsonValue[]).entries())
                    below.push(
                        visit(each, index, `${pointer}/${index}`, level + 1),
                    )
            else if (kind === 'object')
                for (const [name, each] of Object.entries(
                    value as { [key: string]: JsonValue },
                ))
                    below.push(
                        visit(
                            each,
                            name,
                            `${pointer}/${pointerToken(name)}`,
                            level + 1,
                        ),
                    )
            const row: JsonRow = {
                pointer,
                key,
                value,
                kind,
                size:
                    kind === 'array' || kind === 'object'
                        ? below.length
                        : undefined,
                level,
            }
            rows.set(pointer, row)
            entries.set(pointer, below)
            return row
        }
        const root = visit(live(options.value), undefined, '', 1)
        return { root, rows, entries }
    })

    const needles = reactive(() => needlesOf(query(), false))

    // 51.160, 51.161 — WHAT A SEARCH KEEPS: each row matching, in order; each row's entries that
    // match or hold a match — all of them under a row that matches — and the rows holding a match.
    // None while the query is blank.
    const found = reactive(() => {
        const words = needles()
        if (words.length === 0) return undefined
        const { root, entries } = parsed()
        const matching = (text: string | undefined) =>
            text !== undefined && words.every((word) => word.test(text))
        const matches: JsonRow[] = []
        const matched = new Set<string>()
        const kept = new Map<string, readonly JsonRow[]>()
        const holding: string[] = []
        const visit = (row: JsonRow): boolean => {
            const hit = matching(keyText(row)) || matching(valueText(row))
            if (hit) {
                matches.push(row)
                matched.add(row.pointer)
            }
            const below = entries.get(row.pointer) ?? []
            const keeping: JsonRow[] = []
            for (const each of below) if (visit(each)) keeping.push(each)
            if (keeping.length > 0) holding.push(row.pointer)
            kept.set(row.pointer, hit ? below : keeping)
            return hit || keeping.length > 0
        }
        const anything = visit(root)
        return {
            matches,
            matched,
            kept,
            holding,
            roots: anything ? [root] : [],
        }
    })

    // 51.161 — under a query the rows holding a match are open, and a toggle there is held apart from
    // `expanded` for as long as that query stands.
    const searched = reactive<
        { query: string; open: readonly string[] } | undefined
    >(undefined)
    const openRows = reactiveOver<readonly string[]>(
        () => {
            const searching = found()
            if (searching === undefined) return expanded()
            const held = searched()
            return held !== undefined && held.query === query()
                ? held.open
                : searching.holding
        },
        (next) => {
            if (found.peek() === undefined) return expanded.set(next)
            return searched.set({ query: query.peek() ?? '', open: next })
        },
    )

    const view = tree({
        id: base,
        roots: () => found()?.roots ?? [parsed().root],
        children: (row: JsonRow) =>
            (found()?.kept ?? parsed().entries).get(row.pointer),
        key: (row: JsonRow) => row.pointer,
        label: keyText,
        expanded: openRows,
        selected,
    })

    const treeId = `${base}-tree`
    const runsOf = (text: string | undefined): readonly LabelRun[] =>
        text === undefined ? NO_RUNS : labelRuns(text, needles(), MATCH)

    return {
        id: base,
        // 51.163 — typing searches, and the field shows what is searched for.
        search: {
            type: 'search',
            'data-json-inspector': 'search',
            autocomplete: 'off',
            'aria-controls': treeId,
            get value() {
                return query()
            },
            oninput: (event: Event) =>
                query.set((event.currentTarget as HTMLInputElement).value),
        },
        tree: withPart(
            { id: treeId, 'data-json-inspector': 'tree' },
            view.tree,
        ),
        get rows() {
            return view.shown
        },
        row: (row) => {
            const node = view.node(row)
            return {
                item: withPart(
                    {
                        'data-json-inspector': 'item',
                        get 'data-match'() {
                            return found()?.matched.has(row.pointer)
                                ? ''
                                : undefined
                        },
                    },
                    node.item,
                ),
                get keyRuns() {
                    return row.key === undefined
                        ? NO_RUNS
                        : runsOf(keyText(row))
                },
                get valueRuns() {
                    return runsOf(valueText(row))
                },
                get expanded() {
                    return node.expanded
                },
                toggle: node.toggle,
            }
        },
        get matches() {
            return found()?.matches ?? NO_ROWS
        },
        // 51.164
        get inspected() {
            const pointer = selected()
            return pointer === undefined
                ? undefined
                : parsed().rows.get(pointer)
        },
        query,
        expanded,
        selected,
    }
}
