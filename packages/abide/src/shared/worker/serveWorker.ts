// 55.1 — THE THREAD'S SIDE OF A WORKER FILE: the one call the thread was started for (55.4) runs the
// export it names, and what that export answers is posted back — a promise's value once, a
// generator's a chunk per pull (55.5).

import type { FromWorker, ToWorker } from './WorkerMessage.ts'

/**
 * Answers the call posted to this thread out of `module` — the worker file, or the import of it
 * still loading.
 */
export function serveWorker(
    module: Record<string, unknown> | Promise<Record<string, unknown>>,
): void {
    const controller = new AbortController()
    let iterator: AsyncIterator<unknown, unknown> | undefined
    // What a pull or a stop posted while the module still loads waits on.
    let started = () => {}
    const begun = new Promise<void>((done) => (started = done))
    const post = (message: FromWorker) => {
        try {
            postMessage(message)
        } catch (thrown) {
            // 55.2 — an answer the stand-in cannot be handed rejects its call.
            postMessage({ error: thrown } satisfies FromWorker)
        }
    }
    // Each step of the generator, its value or its throw posted.
    const step = async (stepped: () => Promise<IteratorResult<unknown>>) => {
        try {
            const result = await stepped()
            post({ value: result.value, done: result.done === true })
        } catch (error) {
            post({ error })
        }
    }
    self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
        if ('abort' in data) {
            controller.abort()
            return
        }
        if ('pull' in data) {
            await begun
            const pulled = iterator
            if (pulled !== undefined) await step(() => pulled.next())
            return
        }
        if ('stop' in data) {
            await begun
            // 55.7 — the generator's `finally` runs, as a `for await` broken off runs it.
            const stopping = iterator
            if (stopping !== undefined)
                await step(
                    async () =>
                        (await stopping.return?.(undefined)) ?? {
                            value: undefined,
                            done: true,
                        },
                )
            return
        }
        const args = data.args
        for (const at of data.signals) args[at] = controller.signal
        if (data.aborted) controller.abort()
        try {
            const exported = (await module)[data.name] as (
                ...args: unknown[]
            ) => unknown
            const answered = exported(...args)
            if (isAsyncIterator(answered)) {
                // 55.5 — a generator waits for its first pull.
                iterator = answered
                started()
                return
            }
            started()
            post({ value: await answered, done: true })
        } catch (error) {
            started()
            post({ error })
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
