// 55.1 — WHAT AN IMPORT OF A WORKER FILE CALLS: each export's stand-in posts the call to one thread
// running the file, and answers what the export answered there — a promise, or an async generator
// pulled a chunk at a time (55.5). The thread is started by the first call and kept for every call
// after it, which interleave in it as calls to one module would (55.4).

import { stopSignal } from '../reactive/poll.ts'
import type { FromWorker, ToWorker } from './WorkerMessage.ts'

// A server's `Worker` is held open by a reference (55.11); a browser's has none to drop.
type Thread = Worker & { ref?: () => void; unref?: () => void }

/** One call awaiting the thread: what to do with each message for it, and with the thread's end. */
type Pending = {
    answer: (message: FromWorker) => void
    fail: (error: unknown) => void
    /** The listeners 55.6 armed on the call's signals, removed as the call ends. */
    disarm: () => void
}

/** The stand-ins' side of one worker file. `file` names it in an error. */
export class WorkerModule {
    #file: string
    #spawn: () => Thread
    #worker: Thread | undefined = undefined
    #stopping: AbortSignal | undefined = undefined
    #pending = new Map<number, Pending>()
    #nextId = 0
    // 55.8, 37.28 — rejected with the stop's own abort, which was asked for and is no failure.
    #onStop = () => this.#end(this.#stopping?.reason)

    constructor(file: string, spawn: () => Thread) {
        this.#file = file
        this.#spawn = spawn
    }

    /** 55.12 — the export `name` called with `args`, settled as the promise it returned settles. */
    call(name: string, args: unknown[]): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = this.#open(name, args, {
                answer: (message) => {
                    this.#close(id)
                    if ('error' in message) reject(message.error)
                    else resolve(message.value)
                },
                fail: reject,
                disarm: () => {},
            })
        })
    }

    /** 55.5 — the export `name` called with `args`, each chunk pulled from the thread as it is asked for. */
    async *stream(
        name: string,
        args: unknown[],
    ): AsyncGenerator<unknown, unknown> {
        const landed: FromWorker[] = []
        let failure: { error: unknown } | undefined
        let wake = () => {}
        const id = this.#open(name, args, {
            answer: (message) => {
                landed.push(message)
                wake()
            },
            fail: (error) => {
                failure = { error }
                wake()
            },
            disarm: () => {},
        })
        let ended = false
        try {
            for (;;) {
                if (failure === undefined) this.#post({ id, pull: true })
                while (landed.length === 0 && failure === undefined)
                    await new Promise<void>((done) => (wake = done))
                if (failure !== undefined) {
                    ended = true
                    throw failure.error
                }
                const message = landed.shift() as FromWorker
                if ('error' in message) {
                    ended = true
                    throw message.error
                }
                if (message.done) {
                    ended = true
                    return message.value
                }
                yield message.value
            }
        } finally {
            // 55.7 — a consumer that stopped reading stops the generator in the thread.
            if (!ended && this.#pending.has(id)) this.#post({ id, stop: true })
            this.#close(id)
        }
    }

    // Posts the call, arming 55.6 on each `AbortSignal` among its arguments, and answers its id.
    #open(name: string, args: unknown[], pending: Pending): number {
        const id = this.#nextId++
        const signals: number[] = []
        const sent = args.slice()
        const listening: AbortSignal[] = []
        let aborted = false
        const stop = () => this.#post({ id, stop: true })
        for (let at = 0; at < sent.length; at += 1) {
            const signal = sent[at]
            if (!(signal instanceof AbortSignal)) continue
            signals.push(at)
            sent[at] = undefined
            if (signal.aborted) aborted = true
            else {
                signal.addEventListener('abort', stop, { once: true })
                listening.push(signal)
            }
        }
        pending.disarm = () => {
            for (const signal of listening)
                signal.removeEventListener('abort', stop)
        }
        const worker = this.#started()
        if (this.#pending.size === 0) worker.ref?.()
        this.#pending.set(id, pending)
        try {
            this.#post({ id, name, args: sent, signals, aborted })
        } catch (thrown) {
            // 55.2 — an argument the thread cannot be handed fails the call, not the thread.
            this.#close(id)
            pending.fail(thrown)
            return id
        }
        return id
    }

    #close(id: number): void {
        const pending = this.#pending.get(id)
        if (pending === undefined) return
        pending.disarm()
        this.#pending.delete(id)
        if (this.#pending.size === 0) this.#worker?.unref?.()
    }

    #post(message: ToWorker): void {
        this.#worker?.postMessage(message)
    }

    #started(): Thread {
        if (this.#worker !== undefined) return this.#worker
        const worker = this.#spawn()
        worker.onmessage = ({ data }: MessageEvent<FromWorker>) =>
            this.#pending.get(data.id)?.answer(data)
        worker.onerror = (event) => {
            event.preventDefault()
            this.#end(
                new Error(
                    `abide: ${this.#file} failed in its worker: ${event.message}. RULEBOOK 55.9.`,
                ),
            )
        }
        // 55.8 — the app stopping ends the thread, and the next call starts another. 55.9 — so does
        // the thread failing.
        this.#stopping = stopSignal()
        this.#stopping.addEventListener('abort', this.#onStop, { once: true })
        this.#worker = worker
        return worker
    }

    // The thread is gone: every call in flight fails with `error`, and the next call starts another.
    #end(error: unknown): void {
        const worker = this.#worker
        if (worker === undefined) return
        this.#worker = undefined
        this.#stopping?.removeEventListener('abort', this.#onStop)
        this.#stopping = undefined
        worker.terminate()
        const failed = [...this.#pending.values()]
        this.#pending.clear()
        for (const pending of failed) {
            pending.disarm()
            pending.fail(error)
        }
    }
}
