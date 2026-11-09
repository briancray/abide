import type { AssistantEvent } from './AssistantEvent.ts'
import type { Reactive } from './reactive/Reactive.ts'
import type { Method } from './rpc.ts'

/** What every call to `handler` in `events` answered, in order, a failed call's left out. 44.51. */
export function resultsOf<Value>(
    events: readonly AssistantEvent[],
    // Any handler at all: what it is called with, fails with and produces are no part of what it
    // answered, so only the value is read off its call and an `Rpc` of any `Args` is one.
    handler: ((...args: never) => Reactive<Value, never, unknown, unknown>) & {
        method: Method
        address: string | undefined
    },
): Value[] {
    const values: Value[] = []
    for (const event of events)
        if (
            event.type === 'result' &&
            !event.failed &&
            event.handler !== undefined &&
            event.handler.method === handler.method &&
            event.handler.address === handler.address
        )
            values.push(event.value as Value)
    return values
}
