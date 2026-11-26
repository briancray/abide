// 55.1 — WHAT AN IMPORT OF A WORKER FILE CALLS: each export's stand-in starts a thread for the call
// (55.4), posts the call to it, answers what the export answered there — a promise, or an async
// generator pulled a chunk at a time (55.5) — and ends the thread once the call is done (55.11).

import { abortSignal } from '../reactive/abortSignal.ts'
import type { FromWorker, ToWorker } from './WorkerMessage.ts'

/** One call's thread: what posts to it, and what ends it — which a second time does nothing. */
type Thread = { post: (message: ToWorker) => void; end: () => void }

/** The stand-ins' side of one worker file. `file` names it in an error. */
export class WorkerModule {
    #file: string
    #spawn: () => Worker

    constructor(file: string, spawn: () => Worker) {
        this.#file = file
        this.#spawn = spawn
    }

    /** 55.12 — the export `name` called with `args`, settled as the promise it returned settles. */
    call(name: string, args: unknown[]): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const thread = this.#started(
                name,
                args,
                (message) => {
                    thread.end()
                    if ('error' in message) reject(message.error)
                    else resolve(message.value)
                },
                reject,
            )
        })
    }

    /** 55.5 — the export `name` called with `args`, each chunk pulled from the thread as it is read. */
    async *stream(
        name: string,
        args: unknown[],
    ): AsyncGenerator<unknown, unknown> {
        const landed: FromWorker[] = []
        let failure: { error: unknown } | undefined
        let wake = () => {}
        const thread = this.#started(
            name,
            args,
            (message) => {
                landed.push(message)
                wake()
            },
            (error) => {
                failure = { error }
                wake()
            },
        )
        const next = async (): Promise<FromWorker> => {
            while (landed.length === 0 && failure === undefined)
                await new Promise<void>((done) => (wake = done))
            if (failure !== undefined) throw failure.error
            return landed.shift() as FromWorker
        }
        let ended = false
        try {
            for (;;) {
                thread.post({ pull: true })
                const message = await next()
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
            // 55.7 — a consumer that stopped reading stops the generator in the thread, and waits
            // on its `finally` as a `for await` broken off waits on a generator's own.
            if (!ended && failure === undefined) {
                thread.post({ stop: true })
                const stopped = await next()
                if ('error' in stopped) throw stopped.error
            }
            thread.end()
        }
    }

    // Starts the call's thread and posts the call, carrying each `AbortSignal` among its arguments
    // across as 55.6 states, and ending the thread where the app stops (55.8) or the thread fails
    // (55.9). `answer` hears each message, and `fail` what ended the call otherwise.
    #started(
        name: string,
        args: unknown[],
        answer: (message: FromWorker) => void,
        fail: (error: unknown) => void,
    ): Thread {
        const worker = this.#spawn()
        const signals: number[] = []
        const listening: AbortSignal[] = []
        const sent = args.slice()
        let aborted = false
        const abort = () =>
            worker.postMessage({ abort: true } satisfies ToWorker)
        // 55.8, 37.28 — rejected with the stop's own abort, which was asked for and is no failure.
        const stopping = abortSignal()
        const stop = () => {
            thread.end()
            fail(stopping.reason)
        }
        let ended = false
        const thread: Thread = {
            post: (message) => {
                if (!ended) worker.postMessage(message)
            },
            end: () => {
                if (ended) return
                ended = true
                stopping.removeEventListener('abort', stop)
                for (const signal of listening)
                    signal.removeEventListener('abort', abort)
                worker.terminate()
            },
        }
        for (let at = 0; at < sent.length; at += 1) {
            const signal = sent[at]
            if (!(signal instanceof AbortSignal)) continue
            signals.push(at)
            sent[at] = undefined
            if (signal.aborted) aborted = true
            else {
                signal.addEventListener('abort', abort, { once: true })
                listening.push(signal)
            }
        }
        stopping.addEventListener('abort', stop, { once: true })
        worker.onmessage = ({ data }: MessageEvent<FromWorker>) => answer(data)
        worker.onerror = (event) => {
            event.preventDefault()
            thread.end()
            fail(
                new Error(
                    `abide: ${this.#file} failed in its worker: ${event.message}. RULEBOOK 55.9.`,
                ),
            )
        }
        try {
            worker.postMessage({
                name,
                args: sent,
                signals,
                aborted,
            } satisfies ToWorker)
        } catch (thrown) {
            // 55.2 — an argument the thread cannot be handed rejects the call.
            thread.end()
            fail(thrown)
        }
        return thread
    }
}
