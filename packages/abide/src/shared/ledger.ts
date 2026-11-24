// 58 — A LEDGER: events appended and never coalesced, read in order from a position or a named cursor,
// kept where its `store` keeps them. A `reactive` holds one value and a later write replaces it (8.10);
// a ledger holds every entry, and a reader that fell behind is handed each one it missed.
//
// THE STORE IS AN APPEND FACE, NOT A VALUE'S: `store.sqlite` keeps a row per entry rather than the whole
// log as one JSON value, so an append costs one row however long the log has grown (58.9). A ledger
// with no store keeps its entries in memory.
//
// THE LEDGER IS THE `Reactive` OF WHAT IT KEEPS (58.8): one array, patched in place as an entry is
// kept or let go, so a page reads it by name and a `GET` serving it sends each append as a JSON Patch
// (18.11) rather than the whole log. Letting go of the oldest is a `splice(0, n)`, which JSC keeps
// O(1) per entry — 0.05 µs per append at 100,000 kept, measured — so retention is no cost per write.
// Nothing writes it but `append`: its `Accepted` is `never`.
//
// A NAMED CURSOR MOVES PAST AN ENTRY ONCE ITS READER ASKS FOR THE NEXT (58.6): the stream is pulled one
// entry at a time, so taking the next is the reader saying it is done with the last. A reader that
// stops mid-entry finds that entry again — at least once, never skipped.

import { type Reactive, reactive } from './reactive/index.ts'
import { refuse } from './refuse.ts'
import { runSchema, type Schema } from './Schema.ts'

/** One entry of a ledger: its number in order from 1, when it was appended, and what it holds. */
export type Logged<Entry> = { seq: number; at: number; entry: Entry }

/** Where a ledger's entries and its cursors are kept: a `store` with an append face (58.9). */
export type LogStore = {
    append: (
        entry: unknown,
        key: string | undefined,
        at: number,
    ) => number | Promise<number>
    since: (seq: number) => Logged<unknown>[] | Promise<Logged<unknown>[]>
    last: () => number | Promise<number>
    position: (cursor: string, seq?: number) => number | Promise<number>
    trim: (through: number) => void | Promise<void>
    watch?: (changed: () => void) => () => void
}

/** What `ledger` takes. */
export type LedgerOptions<Entry> = {
    store?: LogStore
    retain?: number
    ttl?: number
    schema?: Schema<Entry>
}

/** A ledger: the entries it keeps, appended to, and read in order from a position or a named cursor. */
export type Ledger<Entry> = Reactive<Logged<Entry>[], never> & {
    append: (entry: Entry, options?: { key?: string }) => Promise<number>
    read: (from?: number | { cursor: string }) => ReadableStream<Logged<Entry>>
    readonly writable: WritableStream<Entry>
}

/** Entries appended and read in order, kept in `store`, or in memory where none is given (58). */
export function ledger<Entry>(options?: LedgerOptions<Entry>): Ledger<Entry> {
    const log = options?.store ?? memoryLog()
    const retain = options?.retain
    // 58.11 — at construction: a ledger keeping nothing would lose the number it counts from.
    if (retain !== undefined && !(retain >= 1))
        throw new RangeError(
            `abide: a ledger retains at least one entry. RULEBOOK 58.11.`,
        )
    const ttl = options?.ttl
    const schema = options?.schema as Schema<unknown> | undefined
    // 58.8 — opens at every entry the store keeps; each change after waits for that to land.
    const loaded = keptIn(log)
    const kept = reactive<Logged<unknown>[]>(loaded, { global: true })
    // The value brought to the store: `fresh` pushed, the entries `through` lets go dropped
    // (58.14), and `retain` held (58.10) whoever appended.
    const bring = (fresh: Logged<unknown>[], through: number): void => {
        const list = kept.peek() as Logged<unknown>[]
        let drop = 0
        while (
            drop < list.length &&
            (list[drop] as Logged<unknown>).seq <= through
        )
            drop += 1
        const over =
            retain === undefined
                ? 0
                : list.length - drop + fresh.length - retain
        const gone = drop + Math.max(0, over)
        if (gone === 0 && fresh.length === 0) return
        kept.patch((entries) => {
            for (const entry of fresh) entries.push(entry)
            if (gone > 0) entries.splice(0, Math.min(gone, entries.length))
        })
    }
    // ONE CHANGE AT A TIME, so two never push one entry twice. An append this process made, landing
    // right after the value's last entry with nothing queued, is pushed as it stands: asking the
    // store for what it just answered was a second query per append (19.6 -> 27.3 µs in SQLite).
    let mirroring: Promise<unknown> = loaded
    let queued = 0
    const mirror = (
        through: number,
        appended?: Logged<unknown>,
    ): Promise<unknown> => {
        const list = kept.peek()
        if (list !== undefined && queued === 0 && appended !== undefined) {
            if (appended.seq === (list.at(-1)?.seq ?? 0) + 1) {
                bring([appended], through)
                return mirroring
            }
        }
        queued += 1
        mirroring = mirroring.then(async () => {
            const fresh: Logged<unknown>[] = []
            let last = (kept.peek() as Logged<unknown>[]).at(-1)?.seq ?? 0
            for (;;) {
                const page = await log.since(last)
                if (page.length === 0) break
                for (const entry of page) fresh.push(entry)
                last = (page.at(-1) as Logged<unknown>).seq
            }
            queued -= 1
            bring(fresh, through)
        })
        return mirroring
    }
    // 58.14 — when the oldest entry kept was appended, where a scan has found it: no scan is made
    // while it is inside `ttl`, so an append into a ledger whose oldest entry is fresh reads nothing.
    let oldestAt: number | undefined
    const expire = async (): Promise<void> => {
        if (ttl === undefined) return
        const cutoff = Date.now() - ttl
        if (oldestAt !== undefined && oldestAt >= cutoff) return
        let through = 0
        oldestAt = Number.POSITIVE_INFINITY
        for (;;) {
            const page = await log.since(through)
            if (page.length === 0) break
            let kept: Logged<unknown> | undefined
            for (const entry of page) {
                if (entry.at >= cutoff) {
                    kept = entry
                    break
                }
                through = entry.seq
            }
            if (kept !== undefined) {
                oldestAt = kept.at
                break
            }
        }
        if (through > 0) {
            await log.trim(through)
            await mirror(through)
        }
    }
    // Readers waiting on an entry past the last: woken by the next append in this process.
    const waiting = new Set<() => void>()
    let known: number | Promise<number> = log.last()
    // 58.12 — an append another document or process made, heard where the store reports one.
    log.watch?.(() => {
        known = log.last()
        void Promise.all([known, mirror(0)]).then(([last]) => {
            known = last
            for (const wake of [...waiting]) wake()
        })
    })

    const append = async (
        entry: Entry,
        given?: { key?: string },
    ): Promise<number> => {
        // 58.3 — a gate that refuses is the append's failure: nothing is kept.
        let value: unknown = entry
        if (schema !== undefined) {
            const checked = runSchema(schema, entry)
            if (checked.issues !== null)
                throw new TypeError(
                    'abide: a ledger refused an entry its schema does not accept. RULEBOOK 58.3.',
                )
            value = checked.value
        }
        const at = Date.now()
        const seq = await log.append(value, given?.key, at)
        const last = await known
        if (seq > last) {
            known = seq
            // 58.10 — the oldest entries past `retain` go as the next is kept.
            const through =
                retain !== undefined && seq > retain ? seq - retain : 0
            if (through > 0) await log.trim(through)
            await mirror(0, { seq, at, entry: value })
            if (oldestAt === Number.POSITIVE_INFINITY) oldestAt = Date.now()
            await expire()
            for (const wake of [...waiting]) wake()
        }
        return seq
    }

    const read = (
        from?: number | { cursor: string },
    ): ReadableStream<Logged<Entry>> => {
        const cursor = typeof from === 'object' ? from.cursor : undefined
        let position: number | undefined =
            typeof from === 'number'
                ? from
                : cursor === undefined
                  ? 0
                  : undefined
        let delivered: number | undefined
        let buffered: Logged<unknown>[] = []
        let cancelled = false
        let wake: (() => void) | undefined
        return new ReadableStream<Logged<Entry>>(
            {
                pull: async (controller) => {
                    // 58.6 — the reader asking for the next is done with the last.
                    if (cursor !== undefined && delivered !== undefined)
                        await log.position(cursor, delivered)
                    if (position === undefined)
                        position = await log.position(cursor as string)
                    for (;;) {
                        if (cancelled) return
                        if (buffered.length === 0) {
                            await expire()
                            buffered = await log.since(position)
                        }
                        const next = buffered.shift()
                        if (next !== undefined) {
                            // 58.15 — numbers have no gap (58.2), so a jump is entries let go: said,
                            // not stepped over. A read from 0 starts at the oldest kept, whatever it is.
                            if (position > 0 && next.seq > position + 1) {
                                controller.error(
                                    refuse(
                                        410,
                                        `a ledger let entries ${position + 1} to ${next.seq - 1} go before this read reached them. RULEBOOK 58.15.`,
                                    ),
                                )
                                return
                            }
                            position = next.seq
                            delivered = next.seq
                            controller.enqueue(next as Logged<Entry>)
                            return
                        }
                        // 58.5 — past the last entry the read waits for the next rather than ending.
                        await new Promise<void>((woke) => {
                            wake = () => {
                                waiting.delete(wake as () => void)
                                woke()
                            }
                            waiting.add(wake)
                        })
                    }
                },
                cancel: () => {
                    cancelled = true
                    if (wake !== undefined) wake()
                },
            },
            { highWaterMark: 0 },
        )
    }

    let writable: WritableStream<Entry> | undefined
    return Object.defineProperties(kept, {
        append: { value: append },
        read: { value: read },
        writable: {
            get: () => {
                writable ??= new WritableStream<Entry>({
                    write: async (entry) => {
                        await append(entry)
                    },
                })
                return writable
            },
        },
    }) as unknown as Ledger<Entry>
}

/** Every entry `log` keeps, oldest first, a page at a time. */
async function keptIn(log: LogStore): Promise<Logged<unknown>[]> {
    const entries: Logged<unknown>[] = []
    let last = 0
    for (;;) {
        const page = await log.since(last)
        if (page.length === 0) return entries
        for (const entry of page) entries.push(entry)
        last = (page.at(-1) as Logged<unknown>).seq
    }
}

/**
 * A `LogStore` in memory: the entries in an array, the cursors in a map.
 *
 * 58.10 — A TRIM MOVES AN OFFSET rather than shifting the array, and the array is cut only once
 * the entries let go outnumber the ones kept: a `retain` that dropped one entry per append by
 * splicing copied the whole log on every write.
 */
function memoryLog(): LogStore {
    let entries: Logged<unknown>[] = []
    // The key each entry was appended under, beside it, so a trim forgets its keys (58.4).
    let keys: (string | undefined)[] = []
    // Where in `entries` the first entry still kept sits, and that entry's number.
    let offset = 0
    let first = 1
    let last = 0
    const keyed = new Map<string, number>()
    const cursors = new Map<string, number>()
    return {
        append: (entry, key, at) => {
            if (key !== undefined) {
                const seen = keyed.get(key)
                if (seen !== undefined) return seen
            }
            last += 1
            entries.push({ seq: last, at, entry })
            keys.push(key)
            if (key !== undefined) keyed.set(key, last)
            return last
        },
        since: (seq) => {
            const from = offset + Math.max(0, seq + 1 - first)
            return entries.slice(from, from + 256)
        },
        last: () => last,
        position: (cursor, seq) => {
            if (seq !== undefined) cursors.set(cursor, seq)
            return cursors.get(cursor) ?? 0
        },
        trim: (through) => {
            const drop = Math.min(through + 1 - first, entries.length - offset)
            if (drop <= 0) return
            for (let index = offset; index < offset + drop; index += 1) {
                const key = keys[index]
                if (key !== undefined) keyed.delete(key)
            }
            offset += drop
            first += drop
            if (offset * 2 > entries.length) {
                entries = entries.slice(offset)
                keys = keys.slice(offset)
                offset = 0
            }
        },
    }
}
