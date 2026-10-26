// 46 — THE BROWSER'S OUTBOX: the mutation calls a page could not deliver, kept on the device and sent
// once the network answers, oldest first and one at a time, by one tab for all of them.
//
// KEPT IN IndexedDB, where the browser has it (46.2): the one store a page can write that outlives
// it, holds what JSON cannot (a photo's bytes ride in a call's args), and the worker can read too.
// Where there is none — a DOM emulator — the calls are kept in memory, which is the same queue for
// as long as the page lives.
//
// WHAT `outbox` SHOWS IS WHAT IS KEPT: every change is written first and published after, so a
// reader is never shown a call a reload would lose.

import {
    type Answer,
    answered as answeredValue,
    answerOf,
    unanswered,
} from '#shared/answerOf.ts'
import { failedFrom, isFailed, problemOf } from '#shared/Failed.ts'
import type { Problem } from '#shared/Failed.ts'
import { type ShownCall, showLine, showSending } from '#shared/outbox.ts'
import { onPrincipalRotated } from '#shared/principalRotated.ts'
import {
    isReactive,
    produceInto,
    type Reactive,
    reactive,
    refuseInto,
    standIn,
} from '#shared/reactive/index.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'

const DATABASE = 'abide-outbox'
/** The `localStorage` key set while the line holds a call, so a page with none opens no database. */
const MARKER = 'abide-outbox'
const STORE = 'calls'
const CHANNEL = 'abide-outbox'
const RETRY_FLOOR_MS = 1_000
const RETRY_CEILING_MS = 60_000

/** One call as it is kept: what `outbox` shows of it, its place in line, and how it was refused. */
type Kept = Omit<ShownCall, 'value' | 'retry' | 'discard'> & {
    seq: number | undefined
    error: Problem | undefined
    /** 46.19 — what the call settled to, where the browser could keep it. */
    standIn: unknown
}

/** Where the calls are kept: IndexedDB where the browser has it, this page's memory where not. */
type Shelf = {
    load(): Promise<Kept[]>
    add(call: Kept): Promise<number>
    put(call: Kept): Promise<void>
    remove(seq: number): Promise<void>
}

/** The line, oldest first, as this tab last read it. */
let LINE: Kept[] = []
/** Whether this tab is sending. */
let sending = false
/** 46.6 — a call refused 401 holds the line until `principal` changes or `retry` is called. */
let held = false
let retrying: ReturnType<typeof setTimeout> | undefined
let backoff = RETRY_FLOOR_MS
let askedToPersist = false
/**
 * The value each call stands in for, by its id: the one its call settled, where this page made it,
 * and one rebuilt from what was kept where not (46.18) — what `outbox` shows as `value`, and what
 * the answer lands in (46.7). Held for as long as the call is in the line.
 */
const VALUES = new Map<string, Reactive<unknown>>()
/** What wants to hear the line empty of calls not yet delivered (18.35). */
const DRAINED: (() => void)[] = []

const shelf: Shelf =
    typeof indexedDB === 'undefined' ? memoryShelf() : databaseShelf()
const channel =
    typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel(CHANNEL)

/** The calls not yet delivered: what is waiting, as against what was refused. */
export function undelivered(): number {
    let count = 0
    for (const call of LINE) if (call.error === undefined) count += 1
    return count
}

/** Runs `listener` each time the line holds no call waiting to be delivered (18.35). */
export function whenDelivered(listener: () => void): void {
    DRAINED.push(listener)
}

/**
 * Queues a call that could not be delivered; answers whether it is kept (16.82).
 *
 * `standing` holds the value the call settled, and `settledTo` is the stand-in it settled to.
 */
export async function enqueue(
    call: Pick<Kept, 'id' | 'method' | 'address' | 'url' | 'args'>,
    standing: { value: unknown },
    settledTo: unknown,
): Promise<boolean> {
    const kept: Kept = {
        seq: undefined,
        ...call,
        queuedAt: Date.now(),
        attempts: 1,
        error: undefined,
        standIn: settledTo,
    }
    try {
        kept.seq = await shelf.add(kept)
    } catch (refused) {
        // 46.19 — A STAND-IN THE BROWSER CANNOT KEEP — a function, a DOM node — is left out, and the
        // call is kept without it; anything else that stops the write stops the call (16.82).
        if ((refused as { name?: string })?.name !== 'DataCloneError')
            return false
        kept.standIn = undefined
        try {
            kept.seq = await shelf.add(kept)
        } catch {
            return false
        }
    }
    const reached = standing.value
    if (isReactive(reached)) VALUES.set(call.id, reached as Reactive<unknown>)
    LINE.push(kept)
    publish()
    changed()
    // 46.14 — a call waiting on the network is one the browser must not clear to make room.
    if (!askedToPersist) {
        askedToPersist = true
        void navigator.storage?.persist?.().catch(() => {})
    }
    retryLater()
    return true
}

/** Sends every call waiting, oldest first and one at a time, where this tab may (46.3, 46.9). */
export function deliver(): void {
    // Another tab's calls reach this one's line through `changed`, and an earlier visit's at boot.
    if (sending || held || undelivered() === 0) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    // Where there is none — a DOM emulator's is `null` — this tab is the only one there is to ask.
    const locks = (navigator as { locks?: LockManager | null }).locks
    if (locks === undefined || locks === null) {
        void sendLine()
        return
    }
    void locks
        .request(DATABASE, { ifAvailable: true }, async (lock) => {
            if (lock !== null) await sendLine()
        })
        .catch(() => {})
}

async function sendLine(): Promise<void> {
    sending = true
    try {
        // Another tab may have sent or queued since this one last read the line.
        LINE = await shelf.load()
        publish()
        for (const call of [...LINE]) {
            if (call.error !== undefined) continue
            // 46.13 — a call discarded since the line was read is not sent.
            if (!LINE.some((each) => each.id === call.id)) continue
            showSending(call)
            const answer = await send(call)
            showSending(undefined)
            if (unanswered(answer)) {
                call.attempts += 1
                await shelf.put(call)
                publish()
                retryLater()
                return
            }
            const value = answeredValue(answer)
            if (isFailed(value)) {
                call.error = problemOf(value)
                await shelf.put(call)
                publish()
                refuseInto(valueStanding(call), value)
                // 46.6 — whoever is signed in has to change before the line can go on.
                if (value.status === 401) {
                    held = true
                    return
                }
                continue
            }
            await shelf.remove(call.seq as number)
            LINE = LINE.filter((each) => each.id !== call.id)
            publish()
            produceInto(valueStanding(call), value)
            VALUES.delete(call.id)
        }
        backoff = RETRY_FLOOR_MS
    } catch {
        retryLater()
    } finally {
        sending = false
        showSending(undefined)
        changed()
    }
}

/** One send of a call, carrying the key it carries every time (46.10). */
async function send(call: Kept): Promise<Answer> {
    const request = rpcRequest(call.method, call.address, call.args, 'no-store')
    request.init.headers = {
        ...(request.init.headers as Record<string, string> | undefined),
        'idempotency-key': call.id,
    }
    return await answerOf(request, false, undefined)
}

/**
 * The value `kept` stands in for: this page's own, or one rebuilt from what was kept (46.18) —
 * written here, so its `synced` is false (46.19), and refused where the call was.
 */
function valueStanding(kept: Kept): Reactive<unknown> {
    let value = VALUES.get(kept.id)
    if (value === undefined) {
        const settled = kept.standIn
        value = reactive(() => standIn(settled)) as Reactive<unknown>
        // Landed now, so a refusal written below is not cleared by the body's first run (4.11).
        value.peek()
        if (kept.error !== undefined) refuseInto(value, failedFrom(kept.error))
        VALUES.set(kept.id, value)
    }
    return value
}

/** 46.8 — the next try, backing off from a second to a minute while nothing answers. */
function retryLater(): void {
    clearTimeout(retrying)
    retrying = setTimeout(() => {
        retrying = undefined
        deliver()
    }, backoff)
    backoff = Math.min(backoff * 2, RETRY_CEILING_MS)
}

/** Whether the line last held a call waiting, so the move to none is heard once. */
let waiting = false

/** Shows the line as `outbox` answers it, and tells who asked once nothing is waiting (18.35). */
function publish(): void {
    const now = undelivered() !== 0
    if (waiting && !now)
        queueMicrotask(() => {
            for (const listener of DRAINED) listener()
        })
    waiting = now
    mark(LINE.length !== 0)
    const calls: ShownCall[] = []
    for (const call of LINE) {
        const id = call.id
        calls.push({
            id,
            method: call.method,
            address: call.address,
            url: call.url,
            args: call.args,
            queuedAt: call.queuedAt,
            attempts: call.attempts,
            value: valueStanding(call),
            retry: () => void retry(id),
            discard: () => void discard(id),
        })
    }
    showLine(calls)
}

/**
 * Says whether the line holds a call, for the next page this browser opens to read before it opens
 * the database (`listen`). Written on every change rather than when it flips: another tab may have
 * emptied the line since this one last wrote it.
 */
function mark(holds: boolean): void {
    try {
        if (holds) localStorage.setItem(MARKER, '1')
        else localStorage.removeItem(MARKER)
    } catch {}
}

/** Whether the line held a call when it last changed — `true` where `localStorage` cannot say. */
function marked(): boolean {
    try {
        return localStorage.getItem(MARKER) !== null
    } catch {
        return true
    }
}

/** 46.9 — tells every other tab the line moved, so each shows the one line. */
function changed(): void {
    channel?.postMessage('changed')
}

async function reread(): Promise<void> {
    LINE = await shelf.load()
    publish()
}

/** 46.12 — sends the call `id` names again, at once, and lets go of a line 46.6 held. */
async function retry(id: string): Promise<void> {
    held = false
    for (const call of LINE)
        if (call.id === id && call.error !== undefined) {
            call.error = undefined
            await shelf.put(call)
            // An accepted write clears the refusal (4.11) and is a write here, so the value is
            // waiting again rather than refused, and still not the server's.
            const value = valueStanding(call)
            value.set(value.peek())
        }
    publish()
    changed()
    backoff = RETRY_FLOOR_MS
    deliver()
}

/** 46.13 — drops the call `id` names, sent or not. */
async function discard(id: string): Promise<void> {
    const kept: Kept[] = []
    for (const call of LINE) {
        if (call.id === id) {
            await shelf.remove(call.seq as number)
            VALUES.delete(call.id)
        } else kept.push(call)
    }
    LINE = kept
    publish()
    changed()
}

function memoryShelf(): Shelf {
    const calls = new Map<number, Kept>()
    let next = 1
    return {
        load: async () => [...calls.values()].map((call) => ({ ...call })),
        add: async (call) => {
            const seq = next
            next += 1
            calls.set(seq, { ...call, seq })
            return seq
        },
        put: async (call) => {
            calls.set(call.seq as number, { ...call })
        },
        remove: async (seq) => {
            calls.delete(seq)
        },
    }
}

function databaseShelf(): Shelf {
    let opening: Promise<IDBDatabase> | undefined
    const database = (): Promise<IDBDatabase> => {
        opening ??= new Promise((resolve, reject) => {
            const asked = indexedDB.open(DATABASE, 1)
            asked.onupgradeneeded = () =>
                asked.result.createObjectStore(STORE, {
                    keyPath: 'seq',
                    autoIncrement: true,
                })
            asked.onsuccess = () => resolve(asked.result)
            asked.onerror = () => reject(asked.error)
        })
        return opening
    }
    const inStore = async <Result>(
        mode: IDBTransactionMode,
        work: (store: IDBObjectStore) => IDBRequest<Result>,
    ): Promise<Result> => {
        const store = (await database())
            .transaction(STORE, mode)
            .objectStore(STORE)
        return new Promise((resolve, reject) => {
            const request = work(store)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    }
    return {
        load: () => inStore('readonly', (store) => store.getAll()),
        add: async (call) => {
            const { seq: _, ...unnumbered } = call
            return (await inStore('readwrite', (store) =>
                store.add(unnumbered),
            )) as number
        },
        put: async (call) => {
            await inStore('readwrite', (store) => store.put(call))
        },
        remove: async (seq) => {
            await inStore('readwrite', (store) => store.delete(seq))
        },
    }
}

/**
 * Reads the line kept, and sends on what 46.8 names.
 *
 * 46.8 — WHAT SENDS: the page arriving with calls kept, the network coming back, the page coming into
 * view, and `principal` changing, which also lets go of a line 46.6 held.
 */
function listen(): void {
    if (typeof window === 'undefined') return
    // 46.2, 46.20 — a line kept from an earlier visit, read where one was left: a page with no call kept
    // opens no database, which costs every page with a handler a read before it hydrates.
    if (marked()) void reread().then(deliver, () => {})
    window.addEventListener('online', () => {
        backoff = RETRY_FLOOR_MS
        deliver()
    })
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') deliver()
    })
    onPrincipalRotated(() => {
        held = false
        deliver()
    }, true)
    channel?.addEventListener('message', () => void reread())
}

listen()
