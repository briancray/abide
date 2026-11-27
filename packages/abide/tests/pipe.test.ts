// 57 — A PIPE, called and piped through: steps in order and at once, fan-out, the budget per pipe and
// per group, retries spaced by the one rule, a `Retry-After` holding the step, the deadline, the pause,
// the stop, and the stream face's order and drain. Every timing here is a count or an order, never a
// clock read: a sleep only gives a turn for what is already decided to happen.

import { expect, test } from 'bun:test'

import { flushSync, isFailed, pipe, reactive, refuse } from '#shared'
import { holdUntil } from '#shared/Failed.ts'

const turn = (): Promise<void> => Bun.sleep(1)

/** A stream of `items`, closed after the last. */
function streamOf<Item>(items: Item[]): ReadableStream<Item> {
    return new ReadableStream<Item>({
        start(controller) {
            for (const item of items) controller.enqueue(item)
            controller.close()
        },
    })
}

// 57.1, 57.5 — EACH STEP IS HANDED WHAT THE ONE BEFORE ANSWERED, and a call settles to the last
// answer. THE REVERT: hand every step the item, and `answer: 4`.
test('a pipe hands each step the answer before it — 57.1, 57.5', async () => {
    const steps = pipe([(n: number) => n + 1, async (n: number) => n * 10])
    expect(`answer: ${await steps(3)}`).toBe('answer: 40')
})

// 57.5 — A CALL IS AN ASYNC FUNCTION: it resolves to its item's answer, and rejects with a step's
// refusal, as a handler's call does (16.3). A value a page reads is a derived `reactive` calling it, whose
// error the refusal becomes (15.5). THE REVERT: return `walked.refusal` in `call`, and
// `rejected: resolved`.
test('a call resolves to its answer and rejects with a refusal, and a computed over it fails with it — 57.5, 15.5', async () => {
    const tidy = pipe([async (name: string) => name.trim()])
    const refusing = pipe([() => refuse(409, 'taken')])
    const resolved = await refusing(undefined).then(
        () => 'resolved',
        (refusal) => (isFailed(refusal) ? refusal.status : 'thrown'),
    )
    const shown = reactive(() => refusing(undefined))
    shown.peek()
    await shown.then(
        () => undefined,
        () => undefined,
    )
    expect(
        `${await tidy(' Acme ')} | resolved: ${resolved} | memo error: ${(shown.error() as { status?: number } | undefined)?.status}`,
    ).toBe('Acme | resolved: 409 | memo error: 409')
})

// 57.5, 57.9 — A PIPE THAT IS A STEP REJECTS WITH ITS REFUSAL, read as the step's answer for
// transience: one that is not transient ends the item at once. THE REVERT: drop the `isFailed` arm
// from `attempts`' catch, and the outer pipe retries it as a throw — `asked: 3`.
test('a refusal from a pipe step is an answer, not retried unless transient — 57.5, 57.9', async () => {
    let asked = 0
    const inner = pipe([
        () => {
            asked += 1
            return refuse(404)
        },
    ])
    const outer = pipe([inner], { retries: 2, backoff: 1 })
    const answer = await outer(undefined).catch((refusal: unknown) => refusal)
    expect(
        `asked: ${asked}, answer: ${isFailed(answer) ? answer.status : answer}`,
    ).toBe('asked: 1, answer: 404')
})

// 57.2 — A LIST IS ONE STEP RUN AT ONCE, each member handed the same input, answering in their order
// whatever order they finish in. THE REVERT: chain the members, and `[4, 40]` is `[4, 41]`.
test('a step that is a list runs its members at once on the same input — 57.2', async () => {
    const order: string[] = []
    const both = pipe([
        (n: number) => n + 1,
        [
            async (n: number) => {
                await Bun.sleep(5)
                order.push('slow')
                return n
            },
            (n: number) => {
                order.push('fast')
                return n * 10
            },
        ],
        ([slow, fast]: [number, number]) => [slow, fast],
    ])
    expect(await both(3)).toEqual([4, 40])
    expect(order).toEqual(['fast', 'slow'])
})

// 57.3 — A LIST IN A LIST IS REFUSED where it is written. THE REVERT: drop the check, and `built`.
test('a list inside a list of steps throws at construction — 57.3', () => {
    let said = 'built'
    try {
        pipe([[(n: number) => n, [(n: number) => n]]] as never)
    } catch (thrown) {
        said = (thrown as Error).message.includes('57.3') ? 'refused' : 'other'
    }
    expect(said).toBe('refused')
})

// 57.4, 57.5 — A STEP THAT STREAMS HANDS EACH CHUNK ON as an item of its own, in order, and the
// call settles to every last answer. THE REVERT: hand the iterable on as one value, and the next
// step is handed a generator.
test('a streaming step fans out, each chunk through the rest in order — 57.4, 57.5', async () => {
    const segments = pipe([
        async function* (file: string) {
            yield `${file}:1`
            yield `${file}:2`
            yield `${file}:3`
        },
        (segment: string) => segment.toUpperCase(),
    ])
    expect(await segments('a')).toEqual(['A:1', 'A:2', 'A:3'])
})

// 57.6 — AT MOST `concurrency` ITEMS RUN AT ONCE, one where none is given, the rest waiting in the
// order they came. THE REVERT: start every item as it is called, and `most at once: 5`.
test('a pipe runs at most concurrency items at once, in the order they came — 57.6', async () => {
    let running = 0
    let most = 0
    const started: number[] = []
    const lane = pipe(
        [
            async (n: number) => {
                started.push(n)
                running += 1
                most = Math.max(most, running)
                await Bun.sleep(2)
                running -= 1
                return n
            },
        ],
        { concurrency: 2 },
    )
    await Promise.all([1, 2, 3, 4, 5].map((n) => lane(n)))
    expect(`most at once: ${most}`).toBe('most at once: 2')
    expect(started).toEqual([1, 2, 3, 4, 5])
    let serial = 0
    let serialMost = 0
    const queue = pipe([
        async (n: number) => {
            serial += 1
            serialMost = Math.max(serialMost, serial)
            await turn()
            serial -= 1
            return n
        },
    ])
    await Promise.all([1, 2, 3].map((n) => queue(n)))
    expect(`default most: ${serialMost}`).toBe('default most: 1')
})

// 57.7 — `group` COUNTS `concurrency` PER GROUP: one source's runs wait on each other, another
// source's do not. THE REVERT: drop `group` from `laneOf`, and `a and b together: false`.
test('group counts concurrency per group — 57.7', async () => {
    const running = new Set<string>()
    let together = false
    const bySource = pipe(
        [
            async (run: { source: string; n: number }) => {
                running.add(run.source)
                if (running.size > 1) together = true
                await Bun.sleep(2)
                running.delete(run.source)
                return run.n
            },
        ],
        { group: (run) => run.source },
    )
    await Promise.all([
        bySource({ source: 'a', n: 1 }),
        bySource({ source: 'a', n: 2 }),
        bySource({ source: 'b', n: 3 }),
    ])
    expect(`a and b together: ${together}`).toBe('a and b together: true')
})

// 57.8 — ONE PIPE IS ONE BUDGET wherever it is a step: two pipes sharing an encode lane run one
// encode at a time between them. THE REVERT: give each call a budget of its own, and `most: 2`.
test('a pipe used as a step of two pipes is one budget for both — 57.8', async () => {
    let encoding = 0
    let most = 0
    const encode = pipe(
        [
            async (n: number) => {
                encoding += 1
                most = Math.max(most, encoding)
                await Bun.sleep(2)
                encoding -= 1
                return n
            },
        ],
        { concurrency: 1 },
    )
    const uploads = pipe([(n: number) => n, encode], { concurrency: 4 })
    const previews = pipe([(n: number) => n, encode], { concurrency: 4 })
    await Promise.all([uploads(1), uploads(2), previews(3), previews(4)])
    expect(`most: ${most}`).toBe('most: 1')
})

// 57.9, 57.10 — A THROW AND A TRANSIENT REFUSAL ARE TRIED AGAIN, up to `retries`, spaced by the one
// rule: `backoff` doubled. A refusal that is not transient is the answer at once. THE REVERT: drop
// the retry loop, and `attempts: 1`.
test('a failed attempt is made again up to retries, and a final refusal is not — 57.9, 57.10', async () => {
    let attempts = 0
    const flaky = pipe(
        [
            (n: number) => {
                attempts += 1
                if (attempts < 3) throw new Error('not yet')
                return n
            },
        ],
        { retries: 3, backoff: 1 },
    )
    expect(await flaky(7)).toBe(7)
    expect(`attempts: ${attempts}`).toBe('attempts: 3')
    let asked = 0
    const missing = pipe(
        [
            () => {
                asked += 1
                return refuse(404)
            },
        ],
        { retries: 3, backoff: 1 },
    )
    // 57.5 — the final refusal is what the call rejects with.
    const answer = await missing(1).catch((refusal: unknown) => refusal)
    expect(
        `asked: ${asked}, answer: ${isFailed(answer) ? answer.status : answer}`,
    ).toBe('asked: 1, answer: 404')
})

// 57.11 — A `Retry-After` HOLDS THE STEP FOR EVERY ITEM: the second item's first attempt waits for
// the time the first item's refusal named. THE REVERT: drop the `heldUntil` write, and the second
// item's attempt starts at once — `held: false`.
test('a Retry-After holds the step for every item until the time it names — 57.11', async () => {
    let refusedAt = 0
    let secondAt = 0
    let calls = 0
    const limited = pipe(
        [
            (n: number) => {
                calls += 1
                if (calls === 1) {
                    refusedAt = Date.now()
                    const busy = refuse(429)
                    holdUntil(busy, Date.now() + 40)
                    return busy
                }
                if (n === 2) secondAt = Date.now()
                return n
            },
        ],
        { retries: 1, backoff: 1, concurrency: 2 },
    )
    const first = limited(1)
    await turn()
    const second = limited(2)
    await Promise.all([first, second])
    expect(`held: ${secondAt - refusedAt >= 35}`).toBe('held: true')
})

// 57.12, 57.13 — AN ATTEMPT PAST `timeout` IS ABORTED, its signal saying so, and counted a failure to
// try again. THE REVERT: drop the deadline from `attempts`, and the call never settles.
test('an attempt past timeout is aborted through its signal and tried again — 57.12, 57.13', async () => {
    let attempts = 0
    const slow = pipe(
        [
            (n: number, signal: AbortSignal) =>
                new Promise<number>((settle, fail) => {
                    attempts += 1
                    if (attempts === 2) settle(n)
                    signal.addEventListener('abort', () => fail(signal.reason))
                }),
        ],
        { timeout: 10, retries: 1, backoff: 1 },
    )
    expect(await slow(5)).toBe(5)
    expect(`attempts: ${attempts}`).toBe('attempts: 2')
})

// 57.13 — A CALL MADE IN A `memo` BODY ENDS WITH THE RUN: the next run's abort reaches the step.
// THE REVERT: read no `abortSignal` in `call`, and `superseded step told: false`.
test('a pipe called in a memo body is told when the run is superseded — 57.13, 7.23', async () => {
    const signals: AbortSignal[] = []
    const search = pipe(
        [
            (_q: string, signal: AbortSignal) => {
                signals.push(signal)
                return new Promise<string>(() => undefined)
            },
        ],
        { concurrency: 2 },
    )
    const q = reactive('a')
    const found = reactive(() => search(q()))
    found.peek()
    await turn()
    q.set('ab')
    found.peek()
    flushSync()
    await turn()
    expect(`superseded step told: ${(signals[0] as AbortSignal).aborted}`).toBe(
        'superseded step told: true',
    )
})

// 57.13 — A SIGNAL HANDED IN REPLACES THE ONE READ WHERE THE CALL IS MADE: a lane called from a
// memo body for a job many callers share is the shared job's, and the run that started it being
// superseded does not end it. THE REVERT: join the ambient signal to the one handed in, and
// `handed-in step told: true`.
test('a pipe called with a signal ends on it alone, not on the run it was called in — 57.13', async () => {
    const signals: AbortSignal[] = []
    const lane = pipe(
        [
            (_q: string, signal: AbortSignal) => {
                signals.push(signal)
                return new Promise<string>((_settle, fail) =>
                    signal.addEventListener('abort', () => fail(signal.reason)),
                )
            },
        ],
        { concurrency: 2 },
    )
    const shared = new AbortController()
    const q = reactive('a')
    const found = reactive(() => lane(q(), shared.signal))
    found.peek()
    await turn()
    q.set('ab')
    found.peek()
    flushSync()
    await turn()
    expect(`handed-in step told: ${(signals[0] as AbortSignal).aborted}`).toBe(
        'handed-in step told: false',
    )
    shared.abort()
    expect(
        `told once its own signal aborts: ${(signals[0] as AbortSignal).aborted}`,
    ).toBe('told once its own signal aborts: true')
})

// 57.10 — A `backoff` FUNCTION IS HANDED WHAT THE ATTEMPT BEFORE FAILED WITH, beside the retry's number,
// so a 429 can wait longer than a 503 or a throw. THE REVERT: call `backoff(attempt + 1)` alone in
// `backoffWait`, and `waits: 1 undefined, 2 undefined` where `waits: 1 429, 2 Error` is due.
test('a backoff function is handed the failure it waits after — 57.10', async () => {
    const waits: string[] = []
    let attempts = 0
    const limited = pipe(
        [
            () => {
                attempts += 1
                if (attempts === 1) return refuse(429)
                if (attempts === 2) throw new Error('reset')
                return 'done'
            },
        ],
        {
            retries: 2,
            backoff: (retry, failure) => {
                waits.push(
                    `${retry} ${isFailed(failure) ? failure.status : (failure as Error | undefined)?.name}`,
                )
                return 1
            },
        },
    )
    expect(await limited(undefined as never)).toBe('done')
    expect(`waits: ${waits.join(', ')}`).toBe('waits: 1 429, 2 Error')
})

// 57.14 — A STREAM THAT FAILS AFTER IT YIELDED IS NOT MADE AGAIN: what it handed on cannot be taken
// back. THE REVERT: retry the stream's later chunks, and `opened: 2`.
test('a streaming step that fails after yielding is not tried again — 57.14', async () => {
    let opened = 0
    const segments = pipe(
        [
            async function* () {
                opened += 1
                yield 1
                throw new Error('cut off')
            },
            (n: number) => n,
        ],
        { retries: 3, backoff: 1 },
    )
    let said = ''
    try {
        await segments(undefined as never)
    } catch (thrown) {
        said = (thrown as Error).message
    }
    expect(`opened: ${opened}, said: ${said}`).toBe('opened: 1, said: cut off')
})

// 57.16, 57.19, 57.20 — THE STREAM FACE: items leave in the order written however they finish, and
// the readable side closes once the last has left. THE REVERT: enqueue as each finishes, and the
// order is `[2, 1, 3]`.
test('the stream face keeps the order written and closes once drained — 57.16, 57.19, 57.20', async () => {
    const doubled = pipe(
        [
            async (n: number) => {
                await Bun.sleep(n === 1 ? 8 : 1)
                return n * 2
            },
        ],
        { concurrency: 3 },
    )
    const out: unknown[] = []
    await streamOf([1, 2, 3])
        .pipeThrough(doubled)
        .pipeTo(
            new WritableStream({
                write(answer) {
                    out.push(answer)
                },
            }),
        )
    expect(out).toEqual([2, 4, 6])
})

// 57.15 — ON THE STREAM A FAILED ITEM LEAVES AS A REFUSAL and the stream runs on. THE REVERT: error
// the readable side, and the pipe-to rejects with `bad`.
test('an item that fails on the stream face leaves as a refusal — 57.15', async () => {
    const checked = pipe([
        (n: number) => {
            if (n === 2) throw new Error('bad')
            return n
        },
    ])
    const out: unknown[] = []
    await streamOf([1, 2, 3])
        .pipeThrough(checked)
        .pipeTo(
            new WritableStream({
                write(answer) {
                    out.push(answer)
                },
            }),
        )
    expect(out.length).toBe(3)
    expect((out[1] as { status: number }).status).toBe(500)
})

// 57.17 — WHILE `paused` READS TRUE NO ATTEMPT STARTS; turning false lets the held ones go. THE
// REVERT: drop the pause from `ready`, and `ran while paused: 1`.
test('a paused pipe starts no attempt until the pause lifts — 57.17', async () => {
    const paused = reactive(true)
    let ran = 0
    const held = pipe([(n: number) => ((ran += 1), n)], { paused })
    const answer = held(9)
    await turn()
    const whilePaused = ran
    paused.set(false)
    flushSync()
    expect(await answer).toBe(9)
    expect(`ran while paused: ${whilePaused}, after: ${ran}`).toBe(
        'ran while paused: 0, after: 1',
    )
})

// 57.18 — `stop` ABORTS WHAT RUNS, REFUSES WHAT WAITS AND WHAT COMES LATER. THE REVERT: drop the
// abort in `stop`, and the running step is never told.
test('stop aborts every attempt in flight and refuses every later call — 57.18', async () => {
    let told = false
    const job = pipe([
        (_n: number, signal: AbortSignal) =>
            new Promise<number>((_settle, fail) => {
                signal.addEventListener('abort', () => {
                    told = true
                    fail(signal.reason)
                })
            }),
    ])
    const running = job(1).catch(() => 'aborted')
    const waiting = job(2).catch(() => 'aborted')
    await turn()
    await job.stop()
    const later = await job(3).catch(() => 'refused')
    expect(
        `told: ${told}, running: ${await running}, waiting: ${await waiting}, later: ${later}`,
    ).toBe('told: true, running: aborted, waiting: aborted, later: refused')
})

// 57.21 — `status` IS ONE VALUE OF WHERE THE ITEMS STAND. THE REVERT: never publish, and the counts
// stay at zero.
test('status counts what waits, runs, is done and failed — 57.21', async () => {
    const counted = pipe([
        async (n: number) => {
            await turn()
            if (n === 3) throw new Error('no')
            return n
        },
    ])
    const runs = [counted(1), counted(2), counted(3).catch(() => 0)]
    await turn()
    const during = await counted.status()
    await Promise.all(runs)
    const after = await counted.status()
    expect(`${during.running} running, ${during.waiting} waiting`).toBe(
        '1 running, 2 waiting',
    )
    expect(`${after.done} done, ${after.failed} failed`).toBe(
        '2 done, 1 failed',
    )
})

// 57.6, 57.18 — A LONG QUEUE ADDS NO LISTENER PER ITEM. Items called outside a body with no signal
// of their own end on one signal, and a listener per waiting item on it made each admission scan
// every other: 20,000 queued items took 41 µs apiece where 0.8 is due. Counted, not timed. THE
// REVERT: mark every waiter `shared: false` in `slot`, and `abort listeners under 10: false`.
test('a queue of waiting items adds no abort listener per item — 57.6, 57.18', async () => {
    let added = 0
    // The prototype a combined signal really answers `addEventListener` from: under the DOM preload
    // that is not the global `EventTarget`.
    let owner: object | null = AbortSignal.any([new AbortController().signal])
    while (owner !== null && !Object.hasOwn(owner, 'addEventListener'))
        owner = Object.getPrototypeOf(owner)
    const target = owner as {
        addEventListener: EventTarget['addEventListener']
    }
    const add = target.addEventListener
    target.addEventListener = function (
        this: EventTarget,
        type: string,
        ...rest: unknown[]
    ) {
        if (type === 'abort') added += 1
        return (add as (...given: unknown[]) => void).call(this, type, ...rest)
    } as typeof add
    try {
        const one = pipe([async (n: number) => n])
        const runs: unknown[] = []
        for (let n = 0; n < 1_000; n += 1) runs.push(one(n))
        await Promise.all(runs)
    } finally {
        target.addEventListener = add
    }
    expect(`abort listeners under 10: ${added < 10}`).toBe(
        'abort listeners under 10: true',
    )
})
