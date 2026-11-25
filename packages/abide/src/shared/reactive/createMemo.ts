// 11.2, 11.4 — A MEMO: what a function answers, kept per `Args` key and handed back as it answered —
// a value, a promise, a refusal. Only `reactive` and `computed` produce a `Reactive`; a memo is the
// function, remembered, and a `computed` calling it is what holds its answer as a value.
//
// THE KEYED MACHINERY, WITH THE ANSWER BOXED. Each key's entry is a cell of `createKeyed`, so the
// canonical key (11.24), the args gate (11.27), `ttl` (11.45), tags and the pattern triggers are the
// ones a keyed value always had — and the cell holds an `Answer` rather than what the function
// answered, so a promise is handed back as a promise rather than awaited into the entry. The cell
// is never handed out: the call reads it, which is what subscribes a `computed` calling the memo to
// the key it called (11.75), so a trigger on the key runs that `computed` again.
//
// AN ASYNC ITERABLE IS SHARED (11.76): the entry runs it once and keeps its chunks, and each call is
// a cursor of its own over that run from its start — so two callers each read every chunk, where
// handing both one iterator split the chunks between them.

import { isFailed, isTransient } from '../Failed.ts'
import { isAsyncIterable } from '../isAsyncIterable.ts'
import type { Schema } from '../Schema.ts'
import { answerOfCall } from './answerOfCall.ts'
import { ARGS_GATE, type Gated, PARAMETER_DEFAULTS } from './argsContract.ts'
import { isThenable } from './isThenable.ts'
import { createKeyed, type Keyed } from './Keyed.ts'
import { MEMO_BRAND } from './MEMO_BRAND.ts'
import { isStreaming } from './producer.ts'
import { isStreamBody } from './Reactive.ts'

/** What `memo` takes: how long an entry lives, what selects it, where it is kept, what its args must be. */
export type MemoOptions<Args> = {
    ttl?: number | undefined
    tags?: string[] | ((args: Args) => string[]) | undefined
    global?: boolean | undefined
    args?: Schema<Args> | undefined
}

/** A memo: the function, answering what it answered for args it was called with before (11.2). */
export type Memo<Args, Result> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Result) & {
    invalidate(pattern?: Partial<Args>): void
    refresh(pattern?: Partial<Args>): void
}

/**
 * One entry's answer, boxed so the cell keeping it keeps a promise as a promise. `stale` is set
 * where a promise it holds rejected, or settled to a refusal 15.19 counts transient, so the next
 * call runs the function again.
 */
class Answer {
    result: unknown
    stale: boolean
    constructor(result: unknown) {
        this.result = result
        this.stale = false
    }
}

/** The memo over `fn`. */
export function createMemo<Args, Result>(
    label: string,
    fn: (args: Args) => Result,
    options: MemoOptions<Args> | undefined,
): Memo<Args, Result> & Gated<Args> {
    // 11.76 — AN ASYNC ITERABLE IS THE ENTRY'S STREAM, unboxed: the cell runs it once and keeps its
    // chunks, and every call reads it through a cursor of its own (2.6, 5.10).
    const boxed = (args: Args): unknown => {
        const result = fn(args)
        if (isAsyncIterable(result)) return result
        const answer = new Answer(result)
        if (isThenable(result))
            (result as PromiseLike<unknown>).then(
                (settled) => {
                    if (isFailed(settled) && isTransient(settled.status))
                        answer.stale = true
                },
                () => {
                    answer.stale = true
                },
            )
        return answer
    }
    const keyed = createKeyed<Answer, Args, Answer, never>(
        label,
        // A generator function is handed whole, so its entry streams from construction (9.6).
        (isStreamBody(fn) ? fn : boxed) as (args: Args) => Answer,
        options as never,
    ) as Keyed<Answer, Args, Answer, never> & Gated<Args>
    const call = (...given: [args?: Args]): unknown => {
        const entry = keyed(...(given as [Args]))
        // 11.76 — a stream's entry is answered as a call of a streaming handler is: a cursor of this
        // caller's own over the one run, carrying the entry for a `computed` to adopt.
        if (isStreaming(entry)) return answerOfCall(entry, true)
        let answer: Answer
        try {
            answer = entry()
        } catch (thrown) {
            // 11.27 — args the gate refused are answered as the refusal, as a call over the wire is.
            if (isFailed(thrown)) return thrown
            throw thrown
        }
        // 15.19 — a rejection, or a refusal for now, is run again by the next call.
        if (answer.stale) {
            entry.refresh()
            answer = entry()
        }
        return answer.result
    }
    return Object.assign(call, {
        [MEMO_BRAND]: true,
        [ARGS_GATE]: keyed[ARGS_GATE],
        [PARAMETER_DEFAULTS]: keyed[PARAMETER_DEFAULTS],
        invalidate: keyed.invalidate,
        refresh: keyed.refresh,
    }) as unknown as Memo<Args, Result> & Gated<Args>
}
