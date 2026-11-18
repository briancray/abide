// 55.1 — THE THREAD'S SIDE OF A WORKER FILE: each call its stand-ins post runs the export it names,
// and what that export answers is posted back — a promise's value once, a generator's a chunk per
// pull (55.5).

import type { FromWorker, ToWorker } from './WorkerMessage.ts'

/**
 * A call the thread is running: the controller its signals abort by, and a generator's iterator once
 * `started` — which a pull posted while the module still loads waits on.
 */
type Running = {
    controller: AbortController | undefined
    iterator: AsyncIterator<unknown, unknown> | undefined
    started: Promise<void>
}

/**
 * Answers every call posted to this thread out of `module` — the worker file, or the import of it
 * still loading.
 */
export function serveWorker(
    module: Record<string, unknown> | Promise<Record<string, unknown>>,
): void {
    const running = new Map<number, Running>()
    const post = (message: FromWorker) => {
        try {
            postMessage(message)
        } catch (thrown) {
            // 55.2 — an answer the stand-in cannot be handed fails its call, not the thread.
            postMessage({ id: message.id, error: thrown } satisfies FromWorker)
        }
    }
    self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
        const { id } = data
        if ('stop' in data) {
            const call = running.get(id)
            if (call === undefined) return
            running.delete(id)
            call.controller?.abort()
            await call.started
            // 55.7 — the generator's `finally` runs, as a `for await` broken off runs it.
            await call.iterator?.return?.(undefined)
            return
        }
        if ('pull' in data) {
            const call = running.get(id)
            if (call === undefined) return
            await call.started
            if (call.iterator === undefined || !running.has(id)) return
            try {
                const step = await call.iterator.next()
                if (step.done) running.delete(id)
                post({ id, value: step.value, done: step.done === true })
            } catch (error) {
                running.delete(id)
                post({ id, error })
            }
            return
        }
        let started = () => {}
        const call: Running = {
            controller: undefined,
            iterator: undefined,
            started: new Promise<void>((done) => (started = done)),
        }
        const args = data.args
        if (data.signals.length !== 0) {
            call.controller = new AbortController()
            for (const at of data.signals) args[at] = call.controller.signal
            if (data.aborted) call.controller.abort()
        }
        running.set(id, call)
        try {
            const exported = (await module)[data.name] as (
                ...args: unknown[]
            ) => unknown
            const answered = exported(...args)
            if (isAsyncIterator(answered)) {
                // 55.5 — a generator waits for its first pull.
                call.iterator = answered
                return
            }
            started()
            const value = await answered
            running.delete(id)
            post({ id, value, done: true })
        } catch (error) {
            running.delete(id)
            post({ id, error })
        } finally {
            started()
        }
    }
}

function isAsyncIterator(
    value: unknown,
): value is AsyncIterator<unknown, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        Symbol.asyncIterator in value &&
        typeof (value as { next?: unknown }).next === 'function'
    )
}
