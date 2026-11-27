import { CALL_ENTRY } from './CALL_ENTRY.ts'
import { cellOf } from './cellShape.ts'
import { settledOf } from './Reactive.ts'
import { track, TRACKING } from './tracking.ts'

/**
 * 16.3 — what a call answers for the handler's value `entry`: the promise of its value, rejected with
 * its refusal (16.3), or where the handler streams, the stream of its chunks. Either carries `entry`,
 * so a derived `reactive` handing it back whole adopts the value (11.12).
 *
 * 11.74 — CALLED IN A derived `reactive`, THE CALL IS A READ OF THE VALUE: the reader is subscribed to it, so
 * a body that awaits the answer runs again where the value moves — a server's production (18.10), a
 * refresh.
 *
 * A REJECTION NOBODY AWAITS IS NOT REPORTED: a call handed back whole is adopted and never awaited,
 * and a call made for its effect alone — `onclick={() => save(args)}` — leaves its refusal on the
 * handler (`save.error`) as it always did. Whoever awaits the promise is handed the rejection.
 */
export function answerOfCall(entry: unknown, streams: boolean): object {
    const reader = TRACKING.reader
    if (reader !== null) {
        // The stable arm `Reactive`'s reads inline: a rerun calling at the same spot keeps its
        // subscription, where `track` would drop the tail from here on and push it back.
        const cell = cellOf(entry)
        const at = reader.cursor
        if (reader.sources[at] === cell) reader.cursor = at + 1
        else track(cell, reader)
    }
    let answer: object
    if (streams)
        answer = {
            [Symbol.asyncIterator]: (): AsyncIterator<unknown> =>
                (entry as AsyncIterable<unknown>)[Symbol.asyncIterator](),
        }
    else {
        const settled = settledOf(entry)
        settled.then(undefined, () => undefined)
        answer = settled
    }
    ;(answer as { [CALL_ENTRY]?: unknown })[CALL_ENTRY] = entry
    return answer
}
