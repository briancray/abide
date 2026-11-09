import type { AssistantEvent } from './AssistantEvent.ts'
import type { Reactive } from './reactive/Reactive.ts'
import type { Rpc } from './rpc.ts'

/** What every call to `handler` in `events` answered, in order, a failed call's left out. 44.51. */
export function resultsOf<Value>(
    events: readonly AssistantEvent[],
    // Any `Rpc`, whatever its `Args`: only the value is read off its call.
    handler: ((...args: never) => Reactive<Value, never, unknown, unknown>) &
        Pick<Rpc<Value, never>, 'method' | 'address'>,
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
