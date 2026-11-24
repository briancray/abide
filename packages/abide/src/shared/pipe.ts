// 57 — A PIPE: steps an item runs through in order, under a budget, with retries, a deadline per
// attempt and a pause — a function to call and a `TransformStream` pair to pipe through.
//
// A BUDGET IS A PIPE'S IDENTITY. `concurrency` counts the items this pipe runs, from every caller and
// every pipe it is a step of (57.8), so one pipe declared once and used in many places is one budget,
// and a pipe written inline in another is its own. There is no separate `limit`: a lane is a pipe.
//
// AN ITEM HOLDS ONE SLOT FOR ITS WHOLE WALK, fan-out included: what one item's streaming step yields
// runs on through the steps after it inside that item's slot, in order (57.4). A step that wants its
// chunks run side by side is a pipe of its own with a `concurrency` of its own.

import { type Failed, isFailed, isTransient, retryAt } from './Failed.ts'
import { isAsyncIterable } from './isAsyncIterable.ts'
import { messageOf } from './messageOf.ts'
import {
    abortSignal,
    isReactive,
    type Reactive,
    reactive,
    watch,
} from './reactive/index.ts'
import { isThenable } from './reactive/isThenable.ts'
import { appStopSignal } from './reactive/poll.ts'
import { refuse } from './refuse.ts'
import { type Backoff, backoffWait } from './retryWait.ts'

const PIPE_BRAND: unique symbol = Symbol('abide.pipe')

/** A step's function: the item, and the signal that says its attempt is over. */
type StepFunction = (input: never, signal: AbortSignal) => unknown

/** What one place in a pipe's steps holds: a function, a pipe, or several of those run at once. */
export type Step =
    | StepFunction
    | Pipe<never, unknown, boolean>
    | readonly (StepFunction | Pipe<never, unknown, boolean>)[]

/** Where a pipe's items stand. */
export type PipeStatus = {
    waiting: number
    running: number
    done: number
    failed: number
    paused: boolean
}

/** What `pipe` takes beside its steps. */
export type PipeOptions<In = unknown> = {
    concurrency?: number
    key?: (input: In) => string
    ordered?: boolean
    retries?: number
    backoff?: Backoff
    timeout?: number
    paused?: Reactive<boolean, never, never, boolean> | (() => boolean)
}

/**
 * A pipe: a function from an item to a `Reactive` of its answer, as an `Rpc` is, and a stream pair an
 * item stream is piped through.
 */
export type Pipe<In, Out, Fanned extends boolean = false> = ((
    input: In,
    signal?: AbortSignal,
) => Reactive<
    Fanned extends true ? Out[] : Out,
    Fanned extends true ? Out[] : Out,
    Failed<string, unknown>
>) & {
    readonly readable: ReadableStream<Out | Failed<string, unknown>>
    readonly writable: WritableStream<In>
    readonly status: Reactive<PipeStatus>
    stop(): Promise<void>
}

/** What a step hands on: a pipe's answer, a function's settled answer, a chunk where it streams. */
type StepOut<S> = S extends readonly unknown[]
    ? { -readonly [K in keyof S]: StepOut<S[K]> }
    : S extends Pipe<never, infer Out, infer _Fanned>
      ? Exclude<Out, Failed<string, unknown>>
      : S extends (...given: never[]) => infer Result
        ? Awaited<Result> extends AsyncIterable<infer Chunk>
            ? Chunk
            : Exclude<Awaited<Result>, Failed<string, unknown>>
        : never
/** Whether a step hands on more than one answer per item. */
type StepFans<S> = S extends readonly unknown[]
    ? false
    : S extends Pipe<never, unknown, infer Fanned>
      ? Fanned
      : S extends (...given: never[]) => infer Result
        ? Awaited<Result> extends AsyncIterable<unknown>
            ? true
            : false
        : false
type AnyFans<Steps> = Steps extends readonly [infer First, ...infer Rest]
    ? StepFans<First> extends true
        ? true
        : AnyFans<Rest>
    : false
type StepIn<S> = S extends readonly (infer Member)[]
    ? StepIn<Member>
    : S extends Pipe<infer In, unknown, boolean>
      ? In
      : S extends (input: infer In, signal: AbortSignal) => unknown
        ? In
        : never
type LastOut<Steps> = Steps extends readonly [...unknown[], infer Last]
    ? StepOut<Last>
    : never
type FirstIn<Steps> = Steps extends readonly [infer First, ...unknown[]]
    ? StepIn<First>
    : never

/**
 * Steps an item runs through in order, at most `concurrency` items at once — per `key` where one is
 * given — each step's attempt retried, timed out and held as its options say (57).
 */
export function pipe<const Steps extends readonly [Step, ...Step[]]>(
    steps: Steps,
    options?: PipeOptions<FirstIn<Steps>>,
): Pipe<FirstIn<Steps>, LastOut<Steps>, AnyFans<Steps>> {
    // 57.3 — at construction: an array in an array has no one reading.
    for (const step of steps)
        if (Array.isArray(step))
            for (const member of step)
                if (Array.isArray(member))
                    throw new TypeError(
                        'abide: a pipe step run at once is a list of functions and pipes, not of lists. Write the sequence inside it as a pipe. RULEBOOK 57.3.',
                    )
    const runner = new Runner(
        steps as readonly Step[],
        (options ?? {}) as PipeOptions<unknown>,
    )
    // 57.5 — ONE `Reactive` PER CALL, its item's answer: a refusal is its `error` (2.8), as an `Rpc`'s
    // is. `global`, so a call outside a request is not filed for one per request (11.32).
    const call = (input: unknown, signal?: AbortSignal): unknown =>
        reactive(runner.call(input, signal, true), { global: true })
    return Object.defineProperties(call, {
        [PIPE_BRAND]: { value: runner },
        status: { get: () => runner.status },
        readable: { get: () => runner.streams().readable },
        writable: { get: () => runner.streams().writable },
        stop: { value: () => runner.stop() },
    }) as unknown as Pipe<FirstIn<Steps>, LastOut<Steps>, AnyFans<Steps>>
}

/** An item waiting for a slot: let in, or turned away — and whether it ends on the pipe's shared signal. */
type Waiter = {
    admit: () => void
    refuse: (reason: unknown) => void
    shared: boolean
}
/** One key's slots: how many items run, and the items waiting for one in the order they came. */
type Lane = { running: number; waiting: Waiter[] }

/** What one item's walk answered: its answers in order, whether a step fanned out, or a refusal. */
type Walked = {
    answers: unknown[]
    fanned: boolean
    refusal: Failed<string, unknown> | undefined
}

/** A streaming step's attempt that yielded: the first chunk, and the rest to come. */
class Streamed {
    first: IteratorResult<unknown>
    iterator: AsyncIterator<unknown>
    constructor(
        first: IteratorResult<unknown>,
        iterator: AsyncIterator<unknown>,
    ) {
        this.first = first
        this.iterator = iterator
    }
}

class Runner {
    steps: readonly Step[]
    concurrency: number
    key: ((input: unknown) => string) | undefined
    ordered: boolean
    retries: number
    backoff: Backoff | undefined
    timeout: number | undefined
    pausedBy: (() => boolean) | undefined
    lanes: Map<string, Lane>
    // 57.11 — per step, the epoch ms before which no attempt of it starts.
    heldUntil: number[]
    resumers: (() => void)[]
    stopping: AbortController
    inFlight: Set<Promise<unknown>>
    counts: PipeStatus
    status: Reactive<PipeStatus>
    pair:
        | {
              readable: ReadableStream<unknown>
              writable: WritableStream<unknown>
          }
        | undefined
    unwatch: (() => void) | undefined
    publishing: boolean
    shared: AbortSignal | undefined
    sharedFor: AbortSignal | undefined

    constructor(steps: readonly Step[], options: PipeOptions<unknown>) {
        this.steps = steps
        this.concurrency = options.concurrency ?? 1
        this.key = options.key
        this.ordered = options.ordered ?? true
        this.retries = options.retries ?? 0
        this.backoff = options.backoff
        this.timeout = options.timeout
        const paused = options.paused
        this.pausedBy =
            paused === undefined ? undefined : () => paused() === true
        this.lanes = new Map()
        this.heldUntil = []
        for (let index = 0; index < steps.length; index += 1)
            this.heldUntil.push(0)
        this.resumers = []
        this.stopping = new AbortController()
        this.inFlight = new Set()
        this.counts = {
            waiting: 0,
            running: 0,
            done: 0,
            failed: 0,
            paused: this.pausedBy?.() ?? false,
        }
        // 57.21 — ONE VALUE for every caller in the process, written from whichever turn moves it.
        this.status = reactive<PipeStatus>({ ...this.counts }, { global: true })
        this.pair = undefined
        this.unwatch = undefined
        this.publishing = false
        this.shared = undefined
        this.sharedFor = undefined
        // 57.17 — a pause read as state: its turning false is what lets the held attempts start.
        if (this.pausedBy !== undefined) {
            const read = this.pausedBy
            this.unwatch = watch(() => {
                const now = read()
                if (now === this.counts.paused) return
                this.counts.paused = now
                this.publish()
                if (!now) this.resume()
            })
        }
    }

    /**
     * 57.21 — the counts written to `status` once per turn, however many items moved in it: an item
     * moves them three times (waiting, running, done), and a write per move was most of a no-op
     * item's cost against a hand-written lane.
     */
    publish(): void {
        if (this.publishing) return
        this.publishing = true
        queueMicrotask(() => {
            this.publishing = false
            this.status.set({ ...this.counts })
        })
    }

    resume(): void {
        for (const resumer of this.resumers.splice(0)) resumer()
    }

    /**
     * 57.5, 57.13 — one item, called: its answer, every answer where a step fanned out. A refusal is
     * the answer for a pipe that is a step (57.9 reads its transience), and `rejects` for an app's
     * call — rejecting here rather than in a `then` after was a quarter of the call's own cost.
     */
    async call(
        input: unknown,
        signal?: AbortSignal,
        rejects = false,
    ): Promise<unknown> {
        // 57.13 — read where the call is made: inside a `memo` body, the run's own (7.45).
        const told = abortSignal()
        const walked = await this.item(input, signal, told)
        if (walked.refusal !== undefined) {
            if (rejects) throw walked.refusal
            return walked.refusal
        }
        return walked.fanned ? walked.answers : walked.answers[0]
    }

    /** One item: a slot under 57.6-57.8, its walk through every step, and the slot handed on. */
    async item(
        input: unknown,
        signal: AbortSignal | undefined,
        told: AbortSignal,
    ): Promise<Walked> {
        // 57.18 — a stopped pipe takes nothing.
        if (this.stopping.signal.aborted) throw this.stopping.signal.reason
        const ended = this.endedBy(told, signal)
        const lane = this.laneOf(input)
        await this.slot(lane, ended)
        const walk = this.walk(input, ended)
        this.inFlight.add(walk)
        try {
            const walked = await walk
            if (walked.refusal === undefined) this.counts.done += 1
            else this.counts.failed += 1
            return walked
        } catch (thrown) {
            this.counts.failed += 1
            throw thrown
        } finally {
            this.inFlight.delete(walk)
            this.counts.running -= 1
            this.publish()
            this.release(lane)
        }
    }

    /**
     * 57.13 — the signal an item ends on: the pipe's stop, the stop it was called under, and the
     * caller's. ONE SIGNAL FOR EVERY ITEM in the common case — called outside a body with no signal
     * of its own — made again only where the app's stop has been renewed (7.39): a combined signal
     * per item was a third of a no-op item's cost against a hand-written lane.
     */
    endedBy(told: AbortSignal, signal: AbortSignal | undefined): AbortSignal {
        if (signal === undefined && told === appStopSignal()) {
            if (this.sharedFor !== told) {
                this.sharedFor = told
                const shared = AbortSignal.any([this.stopping.signal, told])
                this.shared = shared
                // 57.18 — every item waiting on it turned away by one listener.
                shared.addEventListener(
                    'abort',
                    () => {
                        for (const lane of this.lanes.values()) {
                            const kept: Waiter[] = []
                            for (const waiter of lane.waiting)
                                if (waiter.shared) waiter.refuse(shared.reason)
                                else kept.push(waiter)
                            lane.waiting = kept
                        }
                    },
                    { once: true },
                )
            }
            return this.shared as AbortSignal
        }
        return AbortSignal.any(
            signal === undefined
                ? [this.stopping.signal, told]
                : [this.stopping.signal, told, signal],
        )
    }

    laneOf(input: unknown): Lane {
        // 57.7 — `concurrency` counts per key.
        const key = this.key === undefined ? '' : this.key(input)
        let lane = this.lanes.get(key)
        if (lane === undefined) {
            lane = { running: 0, waiting: [] }
            this.lanes.set(key, lane)
        }
        return lane
    }

    /** 57.6 — waits for a slot in `lane`, in the order items came. */
    async slot(lane: Lane, ended: AbortSignal): Promise<void> {
        if (lane.running < this.concurrency) {
            lane.running += 1
            this.counts.running += 1
            this.publish()
            return
        }
        this.counts.waiting += 1
        this.publish()
        await new Promise<void>((admitted, refused) => {
            const waiter: Waiter = {
                admit: admitted,
                refuse: (reason) => {
                    this.counts.waiting -= 1
                    this.publish()
                    refused(reason)
                },
                shared: ended === this.shared,
            }
            if (ended.aborted) {
                waiter.refuse(ended.reason)
                return
            }
            lane.waiting.push(waiter)
            // ITS OWN LISTENER ONLY ON ITS OWN SIGNAL. An item ending on the shared one is turned
            // away by that signal's one listener (`endedBy`): a listener per waiting item on one
            // signal made each removal a scan of every other, and a long queue quadratic.
            if (waiter.shared) return
            const leave = (): void => {
                const at = lane.waiting.indexOf(waiter)
                if (at === -1) return
                lane.waiting.splice(at, 1)
                waiter.refuse(ended.reason)
            }
            ended.addEventListener('abort', leave, { once: true })
            waiter.admit = () => {
                ended.removeEventListener('abort', leave)
                admitted()
            }
        })
        // The slot was handed over by `release` with `running` left where it was.
        this.counts.waiting -= 1
        this.counts.running += 1
        this.publish()
    }

    release(lane: Lane): void {
        const next = lane.waiting.shift()
        if (next !== undefined) next.admit()
        else lane.running -= 1
    }

    /** 57.1, 57.4 — the item through every step, a fanned step's chunks through the rest in order. */
    async walk(input: unknown, ended: AbortSignal): Promise<Walked> {
        const walked: Walked = {
            answers: [],
            fanned: false,
            refusal: undefined,
        }
        await this.from(0, input, ended, walked)
        return walked
    }

    async from(
        index: number,
        input: unknown,
        ended: AbortSignal,
        walked: Walked,
    ): Promise<void> {
        if (walked.refusal !== undefined) return
        if (index === this.steps.length) {
            walked.answers.push(input)
            return
        }
        const answer = await this.attempts(index, input, ended)
        if (answer instanceof Streamed) {
            walked.fanned = true
            let step = answer.first
            while (step.done !== true) {
                await this.from(index + 1, step.value, ended, walked)
                if (walked.refusal !== undefined) {
                    await answer.iterator.return?.()
                    return
                }
                // 57.14 — past its first chunk, a stream's failure is the item's: no attempt again.
                step = await answer.iterator.next()
            }
            return
        }
        if (isFailed(answer)) {
            walked.refusal = answer
            return
        }
        await this.from(index + 1, answer, ended, walked)
    }

    /** 57.9-57.12 — a step's attempts: retried, spaced, held and timed out as the options say. */
    async attempts(
        index: number,
        input: unknown,
        ended: AbortSignal,
    ): Promise<unknown> {
        for (let attempt = 0; ; attempt += 1) {
            // The common attempt is neither held nor paused, and waits on nothing.
            if (
                ended.aborted ||
                (this.heldUntil[index] as number) > Date.now() ||
                this.pausedBy?.() === true
            )
                await this.ready(index, ended)
            const deadline =
                this.timeout === undefined
                    ? undefined
                    : AbortSignal.timeout(this.timeout)
            const signal =
                deadline === undefined
                    ? ended
                    : AbortSignal.any([ended, deadline])
            let answer: unknown
            let failure: unknown
            let failed = false
            try {
                answer = await this.attempt(
                    this.steps[index] as Step,
                    input,
                    signal,
                )
            } catch (thrown) {
                // 57.13 — the item's end is not a failure to try again.
                if (ended.aborted) throw ended.reason
                failed = true
                failure = thrown
            }
            if (!failed && !(isFailed(answer) && isTransient(answer.status)))
                return answer
            if (attempt >= this.retries) {
                if (failed) throw failure
                return answer
            }
            // 57.11 — a `Retry-After` holds the step for every item, not this one alone.
            const notBefore = failed ? undefined : retryAt(answer as object)
            if (notBefore !== undefined)
                this.heldUntil[index] = Math.max(
                    this.heldUntil[index] as number,
                    notBefore,
                )
            // 57.10 — the one rule every retry is timed by.
            await sleep(
                backoffWait(this.backoff, attempt, 250, notBefore),
                ended,
            )
        }
    }

    /** One attempt of one step: its answer settled, or the first chunk of a stream it answered. */
    async attempt(
        step: Step,
        input: unknown,
        signal: AbortSignal,
    ): Promise<unknown> {
        if (Array.isArray(step)) {
            // 57.2 — the same input to each at once, and their answers in their order.
            const runs: Promise<unknown>[] = []
            for (const member of step)
                runs.push(this.attempt(member as Step, input, signal))
            const answers = await Promise.all(runs)
            for (const answer of answers) if (isFailed(answer)) return answer
            return answers
        }
        // 57.9 — A PIPE STEP IS ITS RUNNER, whose refusal is an answer to read for transience: called
        // as an app calls it, the refusal would reject its `Reactive` and be retried as a throw.
        const runner = (step as { [PIPE_BRAND]?: Runner })[PIPE_BRAND]
        let answer =
            runner !== undefined
                ? runner.call(input, signal)
                : (step as (input: unknown, signal: AbortSignal) => unknown)(
                      input,
                      signal,
                  )
        // 1.6 — a `Reactive` is thenable and iterable: its value is the step's answer, read first.
        if (isReactive(answer)) answer = await answer
        else if (isThenable(answer)) answer = await answer
        if (isReactive(answer)) answer = await answer
        if (isAsyncIterable(answer)) {
            const iterator = answer[Symbol.asyncIterator]()
            const first = await iterator.next()
            return new Streamed(first, iterator)
        }
        return answer
    }

    /** 57.11, 57.17, 57.18 — waits out the step's hold and the pause, or the item's end. */
    async ready(index: number, ended: AbortSignal): Promise<void> {
        for (;;) {
            if (ended.aborted) throw ended.reason
            const held = (this.heldUntil[index] as number) - Date.now()
            if (held > 0) {
                await sleep(held, ended)
                continue
            }
            if (this.pausedBy?.() === true) {
                await new Promise<void>((resumed, refused) => {
                    const leave = (): void => refused(ended.reason)
                    ended.addEventListener('abort', leave, { once: true })
                    this.resumers.push(() => {
                        ended.removeEventListener('abort', leave)
                        resumed()
                    })
                })
                continue
            }
            return
        }
    }

    /** 57.18 — every attempt aborted, every later call refused, settled once nothing runs. */
    async stop(): Promise<void> {
        if (!this.stopping.signal.aborted) {
            this.stopping.abort(refuse.aborted())
            this.unwatch?.()
        }
        await Promise.allSettled([...this.inFlight])
    }

    /** 57.16, 57.19, 57.20 — the stream pair, made on first reach and the same pair after. */
    streams(): {
        readable: ReadableStream<unknown>
        writable: WritableStream<unknown>
    } {
        if (this.pair !== undefined) return this.pair
        let out!: ReadableStreamDefaultController<unknown>
        const readable = new ReadableStream<unknown>({
            start(controller) {
                out = controller
            },
        })
        let written = 0
        let next = 0
        const finished = new Map<number, unknown[]>()
        const pending = new Set<Promise<void>>()
        const flush = (): void => {
            while (finished.has(next)) {
                for (const answer of finished.get(next) as unknown[])
                    out.enqueue(answer)
                finished.delete(next)
                next += 1
            }
        }
        const told = abortSignal()
        const writable = new WritableStream<unknown>({
            write: async (input) => {
                const sequence = written
                written += 1
                const lane = this.laneOf(input)
                const ended = this.endedBy(told, undefined)
                // 57.20 — the write waits for the slot the item runs in.
                await this.slot(lane, ended)
                const walk = this.walk(input, ended)
                this.inFlight.add(walk)
                const done = walk
                    .then(
                        (walked) => {
                            if (walked.refusal === undefined)
                                this.counts.done += 1
                            else this.counts.failed += 1
                            return walked.refusal === undefined
                                ? walked.answers
                                : [walked.refusal]
                        },
                        (thrown: unknown) => {
                            this.counts.failed += 1
                            // 57.15 — on the stream, a failure leaves as a refusal and the stream runs on.
                            return [refuse(500, messageOf(thrown))]
                        },
                    )
                    .then((answers) => {
                        this.inFlight.delete(walk)
                        this.counts.running -= 1
                        this.publish()
                        this.release(lane)
                        if (this.ordered) {
                            finished.set(sequence, answers)
                            flush()
                        } else for (const answer of answers) out.enqueue(answer)
                    })
                pending.add(done)
                void done.finally(() => pending.delete(done))
            },
            close: async () => {
                // 57.19 — the readable side ends once every item written has left.
                await Promise.allSettled([...pending])
                out.close()
            },
            abort: async (reason) => {
                await this.stop()
                out.error(reason)
            },
        })
        this.pair = { readable, writable }
        return this.pair
    }
}

/** Waits `ms`, or rejects with `ended`'s reason where it aborts first. */
function sleep(ms: number, ended: AbortSignal): Promise<void> {
    return new Promise((woke, refused) => {
        if (ended.aborted) {
            refused(ended.reason)
            return
        }
        const leave = (): void => {
            clearTimeout(timer)
            refused(ended.reason)
        }
        const timer = setTimeout(() => {
            ended.removeEventListener('abort', leave)
            woke()
        }, ms)
        ended.addEventListener('abort', leave, { once: true })
    })
}
