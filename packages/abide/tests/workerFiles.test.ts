// 55 — A WORKER FILE: each call to an export runs in a thread started for it — on a server started
// from its sources here, where the runtime's plugin answers each import with the file's stand-ins
// (`workerFilesPlugin`), and the thread loads the file as written (`workerHost`).
//
// THE REVERT: drop `workerFilesPlugin` from `serveCompilation`. Each import is then the file itself,
// run on this thread — `onMainThread` answers true, two calls share a thread id and a count, a
// function is echoed rather than refused, and nothing stops with the app. The stream, the abort and
// the end of a thread each name a revert of their own.

import { afterAll, expect, test } from 'bun:test'

import { job } from '#server'
import { serveCompilation } from '#server/abideModules.ts'
import { workerExports } from '#server/workerExports.ts'
import { abortSignal, reactive } from '#shared'
import { keyedValue } from '#shared/reactive/index.ts'
import type { WorkerExport } from '#shared/worker/WorkerMessage.ts'

import { inMemoryApp } from './inMemoryApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const THREAD = `import { appendFileSync } from 'node:fs' // bun has no sync append of its own
import { threadId } from 'node:worker_threads' // bun exposes no thread id of its own

import { threadOf } from './other.worker.ts'

let calls = 0

export async function onMainThread(): Promise<boolean> {
    return Bun.isMainThread
}

export async function counted(): Promise<number> {
    calls += 1
    return calls
}

export async function ownThread(): Promise<number> {
    await Bun.sleep(5)
    return threadId
}

export async function* naturals(record: string): AsyncGenerator<number> {
    let produced = 0
    try {
        for (let at = 0; ; at += 1) {
            produced = at + 1
            yield at
        }
    } finally {
        await Bun.write(record, JSON.stringify({ produced, stopped: true }))
    }
}

export async function* finite(to: number): AsyncGenerator<number, string> {
    for (let at = 1; at <= to; at += 1) yield at
    return 'done'
}

export async function ticking(record: string): Promise<string> {
    setInterval(() => appendFileSync(record, '.'), 1)
    return 'ticking'
}

export async function busy(
    milliseconds: number,
    signal: AbortSignal,
): Promise<string> {
    const until = performance.now() + milliseconds
    while (performance.now() < until) signal.throwIfAborted()
    return 'finished'
}

export async function fails(): Promise<never> {
    throw new TypeError('failed in the thread')
}

export async function echo(value: unknown): Promise<unknown> {
    return value
}

export async function never(): Promise<never> {
    return new Promise(() => {})
}

export async function page({ at = 1 }: { at?: number }): Promise<number> {
    return at
}

export async function threads(): Promise<number[]> {
    return [threadId, await threadOf()]
}
`

const OTHER = `import { threadId } from 'node:worker_threads' // bun exposes no thread id of its own

export async function threadOf(): Promise<number> {
    return threadId
}
`

type Thread = {
    onMainThread: () => Promise<boolean>
    counted: () => Promise<number>
    ownThread: () => Promise<number>
    naturals: (record: string) => AsyncGenerator<number>
    finite: (to: number) => AsyncGenerator<number, string>
    ticking: (record: string) => Promise<string>
    busy: (milliseconds: number, signal: AbortSignal) => Promise<string>
    fails: () => Promise<never>
    echo: (value: unknown) => Promise<unknown>
    never: () => Promise<never>
    page: (args: { at?: number }) => Promise<number>
    threads: () => Promise<number[]>
}

// One app, its worker files served as the runtime serves a compilation's.
const dir = temporaryModule({
    'package.json': JSON.stringify({ name: 'threads', type: 'module' }),
    'lib/thread.worker.ts': THREAD,
    'lib/other.worker.ts': OTHER,
})
serveCompilation(dir, {
    files: {},
    handlers: {},
    tables: {},
    workers: {
        'lib/thread.worker.ts': workerExports(
            'lib/thread.worker.ts',
            THREAD,
        ) as Record<string, WorkerExport>,
        'lib/other.worker.ts': workerExports(
            'lib/other.worker.ts',
            OTHER,
        ) as Record<string, WorkerExport>,
    },
})
const thread = (await import(`${dir}/lib/thread.worker.ts`)) as Thread

// THE REVERT, besides the plugin's: keep one thread per file, started by its first call. The two
// calls in flight together answer one thread id, and the count reads 2.
test('each call runs in a thread started for it, two at once in two threads — 55.1, 55.4', async () => {
    expect(await thread.onMainThread()).toBe(false)
    expect(await thread.counted()).toBe(1)
    expect(await thread.counted()).toBe(1)
    const [first, second] = await Promise.all([
        thread.ownThread(),
        thread.ownThread(),
    ])
    expect(first).not.toBe(second)
})

test('a generator export streams, its return value included — 55.5', async () => {
    const chunks: number[] = []
    const stream = thread.finite(3)
    for (;;) {
        const step = await stream.next()
        if (step.done) {
            expect(step.value).toBe('done')
            break
        }
        chunks.push(step.value)
    }
    expect(chunks).toEqual([1, 2, 3])
})

// THE REVERTS: post every chunk as the generator yields it rather than on a pull — `naturals` never
// ends, so the thread floods the stand-in and the test times out; and end the thread at once when the
// consumer stops reading, rather than after the stop — the generator's `finally` never runs, and
// nothing is written to `record`.
test('a stream runs one chunk per chunk read, and a consumer that stops reading ends it — 55.5, 55.7', async () => {
    const record = `${dir}/naturals.json`
    const read: number[] = []
    for await (const natural of thread.naturals(record)) {
        read.push(natural)
        if (read.length === 3) break
    }
    expect(read).toEqual([0, 1, 2])
    expect(await Bun.file(record).json()).toEqual({
        produced: 3,
        stopped: true,
    })
})

// THE REVERT: drop `thread.end()` from the settling of `call` in `WorkerModule`; the thread lives on
// past its answer, and `record` keeps growing.
test('a thread ends once its call has settled — 55.11', async () => {
    const record = `${dir}/ticking.txt`
    expect(await thread.ticking(record)).toBe('ticking')
    await Bun.sleep(20)
    const settled = Bun.file(record).size
    await Bun.sleep(40)
    expect(Bun.file(record).size).toBe(settled)
})

// THE REVERT: hand the abort to the thread as a message rather than ending it — `busy` never yields,
// so the message waits behind the loop, and the call answers 'finished' two seconds later.
test('an abort of a signal argument ends the thread at once, rejecting with its reason — 55.6', async () => {
    const controller = new AbortController()
    const started = performance.now()
    setTimeout(() => controller.abort(new RangeError('given up')), 50)
    const thrown = await thread
        .busy(2_000, controller.signal)
        .catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(RangeError)
    expect((thrown as Error).message).toBe('given up')
    expect(performance.now() - started).toBeLessThan(1_000)
})

// Each `new Worker` the stand-ins make while `body` runs.
async function threadsStarted(body: () => Promise<unknown>): Promise<number> {
    const Spawned = globalThis.Worker
    let started = 0
    globalThis.Worker = class extends Spawned {
        constructor(...args: ConstructorParameters<typeof Worker>) {
            super(...args)
            started += 1
        }
    }
    try {
        await body()
    } finally {
        globalThis.Worker = Spawned
    }
    return started
}

// THE REVERT: spawn the thread before looking at the signals — each call below starts one, and
// the job's runs to its end though the job had stopped before it was made.
test('a call whose signal has aborted already starts no thread — 55.6, 55.8', async () => {
    let thrown: unknown
    expect(
        await threadsStarted(async () => {
            thrown = await thread
                .busy(0, AbortSignal.abort('before'))
                .catch((error: unknown) => error)
        }),
    ).toBe(0)
    expect(thrown).toBe('before')
    let ended: unknown
    const late = job({
        name: 'late',
        every: 3_600_000,
        run: async () => {
            const signal = abortSignal()
            await Bun.sleep(20)
            ended = await thread
                .onMainThread()
                .catch((error: unknown) => error === signal.reason)
        },
    })
    expect(
        await threadsStarted(async () => {
            const running = late.run()
            await late.stop()
            await running
        }),
    ).toBe(0)
    expect(ended).toBe(true)
})

// THE REVERT: end the thread on the signal `abortSignal` answers as well as the one handed in — the
// job's stop ends a call it does not own, and `answered` reads the stop.
test('a call handed a signal ends on it alone, not where its caller stops — 55.8, 57.13', async () => {
    let answered: unknown
    let calling = () => {}
    const called = new Promise<void>((done) => (calling = done))
    const sharing = job({
        name: 'sharing',
        every: 3_600_000,
        run: async () => {
            const answer = thread.busy(300, new AbortController().signal)
            calling()
            answered = await answer.catch((error: unknown) => error)
        },
    })
    const running = sharing.run()
    await called
    await sharing.stop()
    await running
    expect(answered).toBe('finished')
})

test('what an export throws is what its call rejects with — 55.12', async () => {
    const thrown = await thread.fails().catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(TypeError)
    expect((thrown as Error).message).toBe('failed in the thread')
})

test('an argument no thread can be handed rejects its call — 55.2', async () => {
    const thrown = await thread.echo(() => 1).catch((error: unknown) => error)
    expect((thrown as Error).name).toBe('DataCloneError')
    expect(await thread.echo({ kept: [1, 2] })).toEqual({ kept: [1, 2] })
})

test('a worker file the thread imports is the module itself, run in that thread — 55.10', async () => {
    const [own, imported] = await thread.threads()
    expect(imported).toBe(own as number)
})

// A worker export is a function a job's `run` can call: each run is a thread of its own, and the call
// is made where `abortSignal` answers the run's signal (54.32), so `stop` ends the thread and rejects
// the call with the stop (55.8) — the call handed no signal of its own.
test('a job whose run is a worker export runs it off the main thread, and stopping it ends the thread — 54.19, 54.32, 55.8', async () => {
    let onMain: boolean | undefined
    const offloaded = job({
        name: 'offloaded',
        every: 3_600_000,
        run: async () => {
            onMain = await thread.onMainThread()
        },
    })
    await offloaded.run()
    expect(onMain).toBe(false)
    await offloaded.stop()
    let ended: string | undefined
    const waiting = job({
        name: 'waiting',
        every: 3_600_000,
        run: async () => {
            const signal = abortSignal()
            ended = await thread.never().then(
                (answered) => `answered ${answered}`,
                (thrown: unknown) =>
                    thrown === signal.reason
                        ? 'rejected with the stop'
                        : String(thrown),
            )
        },
    })
    const running = waiting.run()
    await waiting.stop()
    await running
    expect(ended).toBe('rejected with the stop')
})

test('the app stopping aborts a call in flight — 55.8, 37.28', async () => {
    const app = await inMemoryApp({})
    const inFlight = thread.never().catch((error: unknown) => error)
    await app.stop()
    expect(((await inFlight) as Error).name).toBe('AbortError')
    expect(await thread.counted()).toBe(1)
})

// THE REVERT: write every stand-in as `(...args)` — it declares a parameter whatever its export
// declares, so `counted` reads as a keyed body, and `reactive` hands back a `Keyed` with no `error`.
test('a reactive reads a stand-in as it reads the export: keyed where it declares a parameter, by its defaults — 55.14', async () => {
    const unkeyed = reactive(thread.counted) as unknown as {
        error: unknown
    }
    expect(typeof unkeyed.error).toBe('function')
    const pages = keyedValue(thread.page) as unknown as (args: {
        at?: number
    }) => PromiseLike<number>
    expect(await pages({})).toBe(1)
    // 11.29 — `{}` and `{ at: 1 }` are one entry, the default being part of the key.
    expect(pages({})).toBe(pages({ at: 1 }))
})

test('an export that is no async function nor async generator function is refused — 55.3', () => {
    expect(
        workerExports(
            'lib/a.worker.ts',
            'export type Kept = number\nexport async function kept(): Promise<Kept> { return 1 }\n',
        ),
    ).toEqual({ kept: { kind: 'call', declares: false, defaults: null } })
    for (const exported of [
        'export const answer = async () => 1',
        'export function plain() { return 1 }',
        'export default async function () {}',
        'async function inner() {}\nexport { inner as renamed }',
    ]) {
        const refused = workerExports('lib/a.worker.ts', exported)
        expect(refused).toBeInstanceOf(Error)
        expect((refused as Error).message).toContain('RULEBOOK 55.3')
    }
})
