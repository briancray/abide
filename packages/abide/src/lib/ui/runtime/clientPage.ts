import type { PageSnapshot } from '../../shared/types/PageSnapshot.ts'
import { state } from '../state.ts'
import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { State } from './types/State.ts'

/*
The client-side page snapshot the `page` proxy reads (startClient registers
`() => clientPage.value` as the page resolver). Server renders never touch this —
there the resolver reads the per-request store instead.

GRANULAR by field: rather than one signal holding the whole snapshot (which woke
every `page.*` reader on any navigation), each field is its own cell and each param
key its own lazily-created cell. So a reader of `page.params.id` subscribes to the id
cell alone and is NOT woken when `page.params.rest` changes (stepping between episodes
on one detail page) — no manual `computed` memo needed at the call site.

The `.value` get/set API is unchanged, so the router and tests still read
`clientPage.value.url` and write `clientPage.value = {…}`: the getter returns a STABLE
snapshot whose field accessors do the granular reads (returning a stable object is what
stops `clientPage.value` itself from subscribing to everything — a subscription happens
only when a field is read), and the setter reconciles each field cell (an Object.is-equal
write is a no-op, so an unchanged id never fires).
*/

const routeCell = state<string>('')
const navigatingCell = state<boolean>(false)
const urlCell = state<URL>(
    typeof location === 'undefined' ? new URL('http://localhost/') : new URL(location.href),
)

/* Per-param-key cells, created on first read/write of a key. A page that reads
   `page.params.id` mints the id cell and subscribes to it alone. Keys persist across
   navigations (the Map is bounded by the app's param vocabulary); a route that drops a
   key sets its cell to undefined so its readers wake to the absence. */
const paramCells = new Map<string, State<string | undefined>>()
function paramCell(key: string): State<string | undefined> {
    let cell = paramCells.get(key)
    if (cell === undefined) {
        cell = state<string>()
        paramCells.set(key, cell)
    }
    return cell
}

/* The surface `page.params` exposes: each key access is a granular cell read, so it
   tracks per-key like the underlying object would, but reactively. */
const paramsProxy = new Proxy({} as Record<string, string>, {
    get: (_target, key) => (typeof key === 'string' ? paramCell(key).value : undefined),
    has: (_target, key) => typeof key === 'string' && paramCell(key).value !== undefined,
    ownKeys: () =>
        [...paramCells].filter(([, cell]) => cell.value !== undefined).map(([key]) => key),
    getOwnPropertyDescriptor: (_target, key) => {
        if (typeof key !== 'string') {
            return undefined
        }
        const value = paramCell(key).value
        if (value === undefined) {
            return undefined
        }
        return { enumerable: true, configurable: true, value }
    },
})

/* The stable snapshot `clientPage.value` returns — reading a field does the granular
   cell read, so a reader subscribes to that field alone. */
const snapshot: PageSnapshot = {
    get route(): string {
        return routeCell.value
    },
    get params(): Record<string, string> {
        return paramsProxy
    },
    get url(): URL {
        return urlCell.value
    },
    get navigating(): boolean {
        return navigatingCell.value
    },
}

/* Reconcile the param cells to `next`: write each key (Object.is in the cell skips a
   no-op, so an unchanged id stays asleep), clear any key the new route dropped. The
   spread-and-rewrite paths (`{ ...clientPage.value, navigating }`) hand our own proxy
   straight back — a no-op, recognised by identity. */
function reconcileParams(next: Record<string, string>): void {
    if (next === paramsProxy) {
        return
    }
    for (const key of Object.keys(next)) {
        paramCell(key).value = next[key]
    }
    for (const [key, cell] of paramCells) {
        if (!(key in next)) {
            cell.value = undefined
        }
    }
}

export const clientPage: { value: PageSnapshot } = {
    get value(): PageSnapshot {
        return snapshot
    },
    set value(next: PageSnapshot) {
        /* Batch the field writes so a navigation publishes the whole snapshot atomically:
           without it each cell write flushes effects separately, so a reader of two fields
           (e.g. `page.url` + `page.params.id`) re-runs once per field and transiently
           observes a half-updated snapshot (new url, stale id). Same batch idiom as
           `createDoc` — flush once, after every cell is reconciled. */
        REACTIVE_CONTEXT.batchDepth += 1
        try {
            routeCell.value = next.route
            urlCell.value = next.url
            navigatingCell.value = next.navigating
            reconcileParams(next.params)
        } finally {
            REACTIVE_CONTEXT.batchDepth -= 1
        }
        flushEffects()
    },
}
