/*
Browser render harness — the real-DOM, real-browser counterpart to the mini-DOM
`render.bench.ts`. It runs the canonical js-framework-benchmark KEYED operations
against abide's `each` + reactive `doc`, and against a hand-written keyed vanilla-JS
baseline in the SAME page/browser/machine, so the two numbers are directly
comparable — the only honest way to line abide up against the public leaderboard,
whose rows are all normalised to keyed vanillajs.

This module is bundled by `run.ts` (Bun.build, target browser) and injected into
`index.html`; `run.ts` then drives headless Chrome over the DevTools Protocol,
calls `window.__bench.runAll()`, and prints a comparison table. Open the built page
directly to eyeball it, or with `?driver=abide` to watch one driver mutate.

Timing model: each op is measured as median-of-N after warmup, bracketing the
mutation with a forced synchronous layout (`offsetHeight`) on both sides so DOM
commit cost is included. This approximates but is not identical to the public
harness, which times against the browser's paint timeline — treat abide-vs-vanilla
RATIOS here as the portable signal, not the absolute millisecond values.
*/

import { appendText } from '../../src/lib/ui/dom/appendText.ts'
import { attr } from '../../src/lib/ui/dom/attr.ts'
import { each } from '../../src/lib/ui/dom/each.ts'
import { mount } from '../../src/lib/ui/dom/mount.ts'
import { on } from '../../src/lib/ui/dom/on.ts'
import { createDoc } from '../../src/lib/ui/runtime/createDoc.ts'

/* Deterministic label vocabulary — the exact word lists the public benchmark uses,
   so generated rows have the same shape/length distribution. */
const ADJECTIVES = [
    'pretty',
    'large',
    'big',
    'small',
    'tall',
    'short',
    'long',
    'handsome',
    'plain',
    'quaint',
    'clean',
    'elegant',
    'easy',
    'angry',
    'crazy',
    'helpful',
    'mushy',
    'odd',
    'unsightly',
    'adorable',
    'important',
    'inexpensive',
    'cheap',
    'expensive',
    'fancy',
]
const COLOURS = [
    'red',
    'yellow',
    'blue',
    'green',
    'pink',
    'brown',
    'purple',
    'brown',
    'white',
    'black',
    'orange',
]
const NOUNS = [
    'table',
    'chair',
    'house',
    'bbq',
    'desk',
    'car',
    'pony',
    'cookie',
    'sandwich',
    'burger',
    'pizza',
    'mouse',
    'keyboard',
]

/* A tiny seeded PRNG (mulberry32) so both drivers see identical label streams and
   runs are reproducible — Math.random would make the two sides diverge. */
function makeRandom(seed: number): () => number {
    let value = seed >>> 0
    return () => {
        value = (value + 0x6d2b79f5) | 0
        let t = Math.imul(value ^ (value >>> 15), 1 | value)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

type Row = { id: string; label: string }

/* Shared row source: fresh ids monotonically increasing, labels drawn from the
   seeded stream, so a given (seed, sequence) always yields the same rows. */
function makeSource() {
    const random = makeRandom(0x1234)
    let nextId = 1
    const pick = (list: string[]) => list[Math.floor(random() * list.length)] as string
    return function build(count: number): Row[] {
        const out: Row[] = new Array(count)
        for (let index = 0; index < count; index += 1) {
            out[index] = {
                id: String(nextId),
                label: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`,
            }
            nextId += 1
        }
        return out
    }
}

/* Force a synchronous layout so the just-issued DOM mutations are actually
   committed before we stop the clock (reflow, not paint). */
function forceLayout(host: HTMLElement): void {
    void host.offsetHeight
}

/* A driver is one framework's implementation of the operation set. mount() builds
   its DOM into `container`; each method performs one benchmark operation and leaves
   the DOM in the documented post-state. */
type Driver = {
    mount(container: HTMLElement): void
    createRows(count: number): void
    replaceAll(count: number): void
    updateEveryTenth(): void
    swapRows(): void
    selectRow(index: number): void
    removeRow(index: number): void
    appendRows(count: number): void
    clear(): void
    rowCount(): number
}

/* --- abide driver: reactive doc + keyed `each`, idiomatic abide expression. --- */
function abideDriver(build: (count: number) => Row[]): Driver {
    /* Model shape mirrors the benchmark: a keyed order list, a by-id label store,
       and a single selected-id signal every row reads for its highlight class. */
    const model = createDoc<{
        order: string[]
        rows: Record<string, { label: string }>
        selected: string
    }>({
        order: [],
        rows: {},
        selected: '',
    })

    function setRows(list: Row[]): void {
        const order: string[] = new Array(list.length)
        const rows: Record<string, { label: string }> = {}
        for (let index = 0; index < list.length; index += 1) {
            const row = list[index] as Row
            order[index] = row.id
            rows[row.id] = { label: row.label }
        }
        model.replace('rows', rows)
        model.replace('order', order)
    }

    return {
        mount(container) {
            mount(container, (root) => {
                const table = document.createElement('table')
                table.className = 'table'
                const tbody = document.createElement('tbody')
                each(
                    tbody,
                    () => model.read<string[]>('order'),
                    (key) => key,
                    (parent, item) => {
                        /* Keyed row: id is stable for the row's whole life, so capture it once. */
                        const id = item.value
                        const tr = document.createElement('tr')
                        attr(tr, 'class', () => (model.read('selected') === id ? 'danger' : ''))
                        const idCell = document.createElement('td')
                        appendText(idCell, () => id)
                        tr.appendChild(idCell)
                        const labelCell = document.createElement('td')
                        const anchor = document.createElement('a')
                        appendText(anchor, () => model.read(`rows/${id}/label`))
                        on(anchor, 'click', () => model.replace('selected', id))
                        labelCell.appendChild(anchor)
                        tr.appendChild(labelCell)
                        const removeCell = document.createElement('td')
                        const removeAnchor = document.createElement('a')
                        removeAnchor.textContent = '×'
                        on(removeAnchor, 'click', () => {
                            const order = model.read<string[]>('order').slice()
                            const at = order.indexOf(id)
                            if (at !== -1) {
                                order.splice(at, 1)
                                model.replace('order', order)
                                model.remove(`rows/${id}`)
                            }
                        })
                        removeCell.appendChild(removeAnchor)
                        tr.appendChild(removeCell)
                        parent.appendChild(tr)
                    },
                    null,
                    true,
                )
                table.appendChild(tbody)
                root.appendChild(table)
            })
        },
        createRows(count) {
            setRows(build(count))
        },
        replaceAll(count) {
            setRows(build(count))
        },
        updateEveryTenth() {
            const order = model.read<string[]>('order')
            for (let index = 0; index < order.length; index += 10) {
                const id = order[index] as string
                const current = model.read<string>(`rows/${id}/label`)
                model.replace(`rows/${id}/label`, `${current} !!!`)
            }
        },
        swapRows() {
            const order = model.read<string[]>('order')
            if (order.length < 999) {
                return
            }
            const next = order.slice()
            const a = next[1] as string
            next[1] = next[998] as string
            next[998] = a
            model.replace('order', next)
        },
        selectRow(index) {
            const order = model.read<string[]>('order')
            model.replace('selected', (order[index] as string) ?? '')
        },
        removeRow(index) {
            const order = model.read<string[]>('order').slice()
            const id = order[index] as string
            order.splice(index, 1)
            model.replace('order', order)
            model.remove(`rows/${id}`)
        },
        appendRows(count) {
            const order = model.read<string[]>('order').slice()
            const extra = build(count)
            for (let index = 0; index < extra.length; index += 1) {
                const row = extra[index] as Row
                model.add(`rows/${row.id}`, { label: row.label })
                order.push(row.id)
            }
            model.replace('order', order)
        },
        clear() {
            model.replace('order', [])
            model.replace('rows', {})
        },
        rowCount() {
            return model.read<string[]>('order').length
        },
    }
}

/* --- vanilla keyed baseline: the reference implementation the public suite calls
   "vanillajs-keyed". Hand-written keyed reconcile, event delegation, no framework. --- */
function vanillaDriver(build: (count: number) => Row[]): Driver {
    let tbody: HTMLTableSectionElement
    let data: Row[] = []
    let selected: string = ''
    const elements = new Map<string, HTMLTableRowElement>()

    function makeRow(row: Row): HTMLTableRowElement {
        const tr = document.createElement('tr')
        tr.dataset.id = row.id
        if (row.id === selected) {
            tr.className = 'danger'
        }
        const idCell = document.createElement('td')
        idCell.textContent = row.id
        tr.appendChild(idCell)
        const labelCell = document.createElement('td')
        const anchor = document.createElement('a')
        anchor.className = 'lbl'
        anchor.textContent = row.label
        labelCell.appendChild(anchor)
        tr.appendChild(labelCell)
        const removeCell = document.createElement('td')
        const removeAnchor = document.createElement('a')
        removeAnchor.className = 'remove'
        removeAnchor.textContent = '×'
        removeCell.appendChild(removeAnchor)
        tr.appendChild(removeCell)
        return tr
    }

    /* Keyed reconcile: reorder existing rows to match `data`, build the missing,
       drop the departed. Mirrors what a keyed framework's diff does. */
    function reconcile(): void {
        const present = new Set<string>()
        for (const row of data) {
            present.add(row.id)
        }
        for (const [id, element] of elements) {
            if (!present.has(id)) {
                element.remove()
                elements.delete(id)
            }
        }
        let cursor: Node | null = null // walk backwards, insert before cursor
        for (let index = data.length - 1; index >= 0; index -= 1) {
            const row = data[index] as Row
            let element = elements.get(row.id)
            if (element === undefined) {
                element = makeRow(row)
                elements.set(row.id, element)
            }
            /* Skip only when already a child of tbody AND correctly positioned — a
               freshly built (detached) node has nextSibling null too, so the
               position check alone would wrongly skip its first insert. */
            if (element.parentNode !== tbody || element.nextSibling !== cursor) {
                tbody.insertBefore(element, cursor)
            }
            cursor = element
        }
    }

    return {
        mount(container) {
            const table = document.createElement('table')
            table.className = 'table'
            tbody = document.createElement('tbody')
            /* Event delegation — one listener, like the reference impl. */
            tbody.addEventListener('click', (event) => {
                const target = event.target as HTMLElement
                const tr = target.closest('tr') as HTMLTableRowElement | null
                if (tr === null || tr.dataset.id === undefined) {
                    return
                }
                const id = tr.dataset.id
                if (target.classList.contains('remove')) {
                    const at = data.findIndex((row) => row.id === id)
                    if (at !== -1) {
                        data.splice(at, 1)
                        reconcile()
                    }
                    return
                }
                if (selected !== '') {
                    elements.get(selected)?.classList.remove('danger')
                }
                selected = id
                elements.get(id)?.classList.add('danger')
            })
            table.appendChild(tbody)
            container.appendChild(table)
        },
        createRows(count) {
            data = build(count)
            reconcile()
        },
        replaceAll(count) {
            data = build(count)
            reconcile()
        },
        updateEveryTenth() {
            for (let index = 0; index < data.length; index += 10) {
                const row = data[index] as Row
                row.label = `${row.label} !!!`
                const element = elements.get(row.id)
                if (element !== undefined) {
                    ;(element.querySelector('a.lbl') as HTMLElement).textContent = row.label
                }
            }
        },
        swapRows() {
            if (data.length < 999) {
                return
            }
            const a = data[1] as Row
            data[1] = data[998] as Row
            data[998] = a
            reconcile()
        },
        selectRow(index) {
            const row = data[index]
            if (row === undefined) {
                return
            }
            if (selected !== '') {
                elements.get(selected)?.classList.remove('danger')
            }
            selected = row.id
            elements.get(selected)?.classList.add('danger')
        },
        removeRow(index) {
            data.splice(index, 1)
            reconcile()
        },
        appendRows(count) {
            data = data.concat(build(count))
            reconcile()
        },
        clear() {
            data = []
            reconcile()
        },
        rowCount() {
            return data.length
        },
    }
}

/* One benchmark operation: bring the driver to `setup`'s post-state (untimed), then
   time `action`. Post-state assertions live in `runAll`. */
type Operation = {
    name: string
    reps: number
    setup: (driver: Driver) => void
    action: (driver: Driver) => void
}

/* The canonical keyed operation set (same names/semantics as the public suite). */
const OPERATIONS: Operation[] = [
    { name: 'create 1k', reps: 12, setup: (d) => d.clear(), action: (d) => d.createRows(1000) },
    {
        name: 'replace all (1k)',
        reps: 12,
        setup: (d) => d.createRows(1000),
        action: (d) => d.replaceAll(1000),
    },
    {
        name: 'partial update (every 10th of 10k)',
        reps: 12,
        setup: (d) => d.createRows(10000),
        action: (d) => d.updateEveryTenth(),
    },
    {
        name: 'select row',
        reps: 40,
        setup: (d) => d.createRows(1000),
        action: (d) => d.selectRow(500),
    },
    {
        name: 'swap rows (1k)',
        reps: 40,
        setup: (d) => d.createRows(1000),
        action: (d) => d.swapRows(),
    },
    {
        name: 'remove row',
        reps: 40,
        setup: (d) => d.createRows(1000),
        action: (d) => d.removeRow(500),
    },
    { name: 'create 10k', reps: 6, setup: (d) => d.clear(), action: (d) => d.createRows(10000) },
    {
        name: 'append 1k to 10k',
        reps: 8,
        setup: (d) => d.createRows(10000),
        action: (d) => d.appendRows(1000),
    },
    { name: 'clear 10k', reps: 8, setup: (d) => d.createRows(10000), action: (d) => d.clear() },
]

const WARMUP = 3

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    return sorted[sorted.length >> 1] as number
}

/* Run every operation for one driver, warming up then taking the median timed run. */
function runDriver(host: HTMLElement, driver: Driver): Record<string, number> {
    const results: Record<string, number> = {}
    for (const operation of OPERATIONS) {
        const samples: number[] = []
        for (let rep = 0; rep < operation.reps + WARMUP; rep += 1) {
            operation.setup(driver)
            forceLayout(host)
            const start = performance.now()
            operation.action(driver)
            forceLayout(host)
            const elapsed = performance.now() - start
            if (rep >= WARMUP) {
                samples.push(elapsed)
            }
        }
        results[operation.name] = median(samples)
    }
    return results
}

type BenchReport = {
    drivers: Record<string, Record<string, number>>
    operations: string[]
    userAgent: string
}

function runAll(): BenchReport {
    const source = makeSource()
    const drivers: [string, Driver][] = [
        ['abide', abideDriver(source)],
        ['vanilla', vanillaDriver(source)],
    ]
    const out: Record<string, Record<string, number>> = {}
    for (const [name, driver] of drivers) {
        const host = document.createElement('div')
        host.id = `host-${name}`
        document.body.appendChild(host)
        driver.mount(host)
        out[name] = runDriver(host, driver)
        host.remove()
    }
    return {
        drivers: out,
        operations: OPERATIONS.map((operation) => operation.name),
        userAgent: navigator.userAgent,
    }
}
/* Expose to the DevTools-Protocol driver (run.ts) and to manual page loads. */
;(window as unknown as { __bench: { runAll: () => BenchReport } }).__bench = { runAll }

/* Manual mode: `?driver=abide` (or `vanilla`) mounts that driver with 1k rows so
   you can watch it in a real browser tab. Default just reports it's ready. */
const requested = new URLSearchParams(location.search).get('driver')
if (requested === 'abide' || requested === 'vanilla') {
    const source = makeSource()
    const driver = requested === 'abide' ? abideDriver(source) : vanillaDriver(source)
    const host = document.createElement('div')
    document.body.appendChild(host)
    driver.mount(host)
    driver.createRows(1000)
}
