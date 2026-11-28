// 58 — A LEDGER: events appended and never coalesced, read in order from a position or a named cursor,
// kept where its `store` keeps them. A `reactive` holds one value and a later write replaces it (8.10);
// a ledger holds every entry, and a reader that fell behind is handed each one it missed.
//
// THE STORE IS AN APPEND FACE, NOT A VALUE'S: `store.sqlite` keeps a row per entry rather than the whole
// log as one JSON value, so an append costs one row however long the log has grown (58.9). A ledger
// with no store keeps its entries in memory.
//
// CALLING A LEDGER READS IT (58.5): what it answers is a stream, and a page that wants the entries as a value hands that
// stream to a derived `reactive`, which accumulates it (9.6) — `global` where many readers share one read. The
// ledger holds no copy of its entries, so one only appended to and read by a cursor costs no memory
// for the log it keeps, and constructing one reads nothing (58.8).
//
// A NAMED CURSOR MOVES PAST AN ENTRY ONCE ITS READER ASKS FOR THE NEXT (58.6): the stream is pulled one
// entry at a time, so taking the next is the reader saying it is done with the last. A reader that
// stops mid-entry finds that entry again — at least once, never skipped.

import { refuse } from './refuse.ts'
import { runSchema, type Schema } from './Schema.ts'
import { SOURCE_KIND } from './SOURCE_KIND.ts'

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
    watch?: ((changed: () => void) => () => void) | undefined
    // 58.17 — which log the store answers from, where it can be another's: a file reopened as another.
    origin?: (() => string | Promise<string>) | undefined
    // 18.46 — an append made only where `expected` is still the last number, answering the new one,
    // or `undefined` where another writer appended first.
    appendAt: (
        entry: unknown,
        expected: number,
        at: number,
    ) => number | undefined | Promise<number | undefined>
}

/** What `ledger` takes. */
export type LedgerOptions<Entry> = {
    store?: LogStore | undefined
    retain?: number | undefined
    ttl?: number | undefined
    schema?: Schema<Entry> | undefined
}

/** A ledger: called, a read in order from a position or a named cursor; appended to, and written to. */
export type Ledger<Entry> = ((
    from?: number | { cursor: string },
) => ReadableStream<Logged<Entry>>) & {
    append: (
        entry: Entry,
        options?: { key?: string | undefined },
    ) => Promise<number>
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
        if (through > 0) await log.trim(through)
    }
    // Readers waiting on an entry past the last: woken by the next append in this process.
    const waiting = new Set<() => void>()
    const wakeAll = (): void => {
        for (const wake of [...waiting]) wake()
    }
    // 58.8 — the last number the store holds, asked for by the first append rather than at
    // construction.
    let known: number | Promise<number> | undefined
    // 58.12 — an append another document or process made, heard where the store reports one.
    log.watch?.(() => {
        const asked = log.last()
        known = asked
        void Promise.resolve(asked).then((last) => {
            known = last
            wakeAll()
        })
    })

    const append = async (
        entry: Entry,
        given?: { key?: string | undefined },
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
        known ??= log.last()
        const seq = await log.append(value, given?.key, Date.now())
        const last = await known
        if (seq > last) {
            known = seq
            // 58.10 — the oldest entries past `retain` go as the next is kept.
            if (retain !== undefined && seq > retain)
                await log.trim(seq - retain)
            if (oldestAt === Number.POSITIVE_INFINITY) oldestAt = Date.now()
            await expire()
            wakeAll()
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
        let origin: string | undefined
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
                            // 58.17 — a position counts in one log; another's numbers say nothing of it.
                            if (log.origin !== undefined) {
                                const now = await log.origin()
                                if (origin !== undefined && now !== origin) {
                                    controller.error(
                                        refuse(
                                            410,
                                            `a ledger's store answers from another log than this read began on; read it again. RULEBOOK 58.17.`,
                                        ),
                                    )
                                    return
                                }
                                origin = now
                            }
                            buffered = await log.since(position)
                            // 58.15 — nothing kept past the position, though the log numbers past it.
                            if (buffered.length === 0 && position > 0) {
                                const last = await (known ??= log.last())
                                if (last > position) {
                                    controller.error(
                                        refuse(
                                            410,
                                            `a ledger let entries ${position + 1} to ${last} go before this read reached them. RULEBOOK 58.15.`,
                                        ),
                                    )
                                    return
                                }
                            }
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
    return Object.defineProperties(read, {
        // 16.117 — read by `rpc` for its face.
        [SOURCE_KIND]: { value: { kind: 'ledger' } },
        append: { value: append },
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
    }) as Ledger<Entry>
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
    const append = (entry: unknown, key: string | undefined, at: number) => {
        if (key !== undefined) {
            const seen = keyed.get(key)
            if (seen !== undefined) return seen
        }
        last += 1
        entries.push({ seq: last, at, entry })
        keys.push(key)
        if (key !== undefined) keyed.set(key, last)
        return last
    }
    return {
        append,
        appendAt: (entry, expected, at) =>
            expected === last ? append(entry, undefined, at) : undefined,
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
