// The hand-written comparison. Every bench arm that is not abide is built out of this file.
//
// A performance claim is a RATIO against hand-written code in the same substrate, so the vanilla
// side has to be the code someone would actually write — not a strawman, and not a second framework.
// Where the vanilla version can be written carelessly or carefully, BOTH are here, because the
// difference between them is usually the whole point of the machinery.

// --- a reactive cell, by hand -----------------------------------------------

export interface VanillaCell<T> {
    get(): T
    set(next: T): void
    subscribe(listener: () => void): () => void
}

/** The careful version: an identity check, so a write of the value already held notifies nobody. */
export function cell<T>(initial: T): VanillaCell<T> {
    let value = initial
    const listeners = new Set<() => void>()
    return {
        get: () => value,
        set(next: T) {
            if (next === value) return
            value = next
            for (const listener of listeners) listener()
        },
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

/** The careless version: notify on every write. This is what most hand-rolled stores do. */
export function naiveCell<T>(initial: T): VanillaCell<T> {
    let value = initial
    const listeners = new Set<() => void>()
    return {
        get: () => value,
        set(next: T) {
            value = next
            for (const listener of listeners) listener()
        },
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

/**
 * A hand-written derivation. The sources have to be DECLARED — that is the cost vanilla pays for not
 * having tracking, and it is also where the bugs come from when the list drifts from the body.
 */
export function derived<T>(sources: VanillaCell<unknown>[], compute: () => T): VanillaCell<T> {
    let dirty = true
    let value: T = undefined as T
    const listeners = new Set<() => void>()
    for (const source of sources) {
        source.subscribe(() => {
            dirty = true
            for (const listener of listeners) listener()
        })
    }
    return {
        get() {
            if (dirty) {
                value = compute()
                dirty = false
            }
            return value
        },
        set() {
            throw new Error('a derivation is not writable')
        },
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

/** …and the careful one, which also refuses to notify when the recomputed value did not move. */
export function derivedMemoised<T>(sources: VanillaCell<unknown>[], compute: () => T): VanillaCell<T> {
    let value: T = compute()
    const listeners = new Set<() => void>()
    for (const source of sources) {
        source.subscribe(() => {
            const next = compute()
            if (next === value) return
            value = next
            for (const listener of listeners) listener()
        })
    }
    return {
        get: () => value,
        set() {
            throw new Error('a derivation is not writable')
        },
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

// --- a pub/sub channel, by hand ---------------------------------------------

export interface VanillaFeed<T> {
    publish(message: T): void
    latest(): T | undefined
    chunks(): T[]
    subscribe(listener: (message: T) => void): () => void
}

export function feed<T>(tail = 0): VanillaFeed<T> {
    let latest: T | undefined
    let transcript: T[] = []
    const listeners = new Set<(message: T) => void>()
    return {
        publish(message: T) {
            latest = message
            if (tail > 0) {
                transcript = transcript.concat(message)
                if (transcript.length > tail) transcript = transcript.slice(-tail)
            }
            for (const listener of listeners) listener(message)
        },
        latest: () => latest,
        chunks: () => transcript,
        subscribe(listener: (message: T) => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

// --- consuming an async iterable, by hand ------------------------------------

export interface VanillaStream<T> {
    latest(): T | undefined
    chunks(): T[]
    streaming(): boolean
    done(): boolean
    subscribe(listener: () => void): () => void
}

/**
 * What a cell that consumes an async iterable replaces: a loop, four fields, and a notify.
 *
 * The careless part is the notify — one per chunk is right, and the shape everyone reaches for is a
 * single "state changed" record rebuilt per chunk, which cannot dedupe anything and wakes every
 * reader for every field. This one notifies once per chunk on purpose, so the bench is measuring the
 * framework against a hand-written form that already got the wake count right.
 */
export function stream<T>(source: AsyncIterable<T>): VanillaStream<T> {
    let latest: T | undefined
    let transcript: T[] = []
    let running = true
    let finished = false
    const listeners = new Set<() => void>()
    const notify = (): void => {
        for (const listener of listeners) listener()
    }
    void (async () => {
        try {
            for await (const chunk of source) {
                latest = chunk
                transcript = transcript.concat(chunk)
                notify()
            }
            finished = true
        } finally {
            running = false
            notify()
        }
    })()
    return {
        latest: () => latest,
        chunks: () => transcript,
        streaming: () => running,
        done: () => finished,
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

// --- an args-keyed cache, by hand -------------------------------------------

export function keyedCache<T>(body: (key: string) => Promise<T>): {
    read(key: string): T | undefined
    load(key: string): Promise<T>
    /** The careless version: no coalescing, so n concurrent callers start n loads. */
    loadNaive(key: string): Promise<T>
} {
    const settled = new Map<string, T>()
    const inFlight = new Map<string, Promise<T>>()
    return {
        read: (key) => settled.get(key),
        load(key) {
            const held = settled.get(key)
            if (held !== undefined) return Promise.resolve(held)
            const running = inFlight.get(key)
            if (running !== undefined) return running
            const started = body(key).then((value) => {
                settled.set(key, value)
                inFlight.delete(key)
                return value
            })
            inFlight.set(key, started)
            return started
        },
        loadNaive(key) {
            const held = settled.get(key)
            if (held !== undefined) return Promise.resolve(held)
            return body(key).then((value) => {
                settled.set(key, value)
                return value
            })
        },
    }
}

// --- DOM lists, by hand -----------------------------------------------------

export interface Row {
    id: number
    label: string
}

export function rows(n: number, seed = 0): Row[] {
    const items: Row[] = []
    for (let i = 0; i < n; i++) items.push({ id: i, label: `row ${i}${seed === 0 ? '' : ` · ${seed}`}` })
    return items
}

/** The surgical build: one element and one text node per row, appended through a fragment. */
export function buildRows(host: Element, items: Row[]): void {
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < items.length; i++) {
        const li = document.createElement('li')
        li.textContent = (items[i] as Row).label
        fragment.append(li)
    }
    host.replaceChildren(fragment)
}

/** The one-liner everybody writes first. Fast to build, ruinous to update. */
export function buildRowsInnerHTML(host: Element, items: Row[]): void {
    let markup = ''
    for (let i = 0; i < items.length; i++) markup += `<li>${escapeHtml((items[i] as Row).label)}</li>`
    host.innerHTML = markup
}

/** Update one row the way a careful hand-written app does: touch exactly the node that changed. */
export function updateRow(host: Element, index: number, label: string): void {
    const child = host.children[index] as HTMLElement | undefined
    if (child !== undefined && child.textContent !== label) child.textContent = label
}

/**
 * Move two rows the way a careful hand-written app does: two insertBefore calls and no rebuild,
 * whatever the distance between them. This is the arm a keyed reconcile is measured against.
 */
export function swapRows(host: Element, a: number, b: number): void {
    const first = host.children[a] as ChildNode | undefined
    const second = host.children[b] as ChildNode | undefined
    if (first === undefined || second === undefined || first === second) return
    const afterSecond = second.nextSibling
    host.insertBefore(second, first)
    host.insertBefore(first, afterSecond)
}

/**
 * Adopt server markup the way a hand-written app does: find the nodes you will need to touch later
 * and keep references to them. No markers, because the author already knows the shape — which is
 * exactly the knowledge a framework has to recover from the markup, and the reason this arm is the
 * floor rather than a fair fight.
 *
 * The returned array is what makes it honest: an adopt that walks and keeps nothing has adopted
 * nothing, and would time as instant.
 */
export function adoptRows(host: Element): Text[] {
    const children = host.children
    const texts: Text[] = []
    for (let i = 0; i < children.length; i++) {
        const first = (children[i] as Element).firstChild
        if (first !== null && first.nodeType === 3) texts.push(first as Text)
    }
    return texts
}

/** The markup `adoptRows` expects, so the two arms start from the same bytes. */
export function rowsToString(items: Row[]): string {
    let markup = '<ul>'
    for (let i = 0; i < items.length; i++) markup += `<li>${escapeHtml((items[i] as Row).label)}</li>`
    return `${markup}</ul>`
}

// --- server rendering, by hand ----------------------------------------------

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

/** Probes before it replaces — the same thing `escape` in `html.ts` does. */
export function escapeHtml(value: string): string {
    if (!/[&<>"']/.test(value)) return value
    return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string)
}

/** The careless one: `replace` with a callback allocates on every call, hit or not. */
export function escapeAlways(value: string): string {
    return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string)
}

/** Hand-written SSR: a string built by concatenation, escaping at each slot. */
export function tableToString(items: Row[]): string {
    let out = '<table><tbody>'
    for (let i = 0; i < items.length; i++) {
        const item = items[i] as Row
        out += `<tr><td>${item.id}</td><td>${escapeHtml(item.label)}</td></tr>`
    }
    return `${out}</tbody></table>`
}

/** The same, through an array join — the other thing people reach for. */
export function tableToStringJoin(items: Row[]): string {
    const parts: string[] = ['<table><tbody>']
    for (let i = 0; i < items.length; i++) {
        const item = items[i] as Row
        parts.push('<tr><td>', String(item.id), '</td><td>', escapeHtml(item.label), '</td></tr>')
    }
    parts.push('</tbody></table>')
    return parts.join('')
}
