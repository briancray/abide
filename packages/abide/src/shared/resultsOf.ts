import type { AssistantEvent } from './AssistantEvent.ts'
import type { Rpc } from './rpc.ts'

/** What every call to `handler` in `events` answered, in order, a failed call's left out. 44.51. */
export function resultsOf<Value>(
    events: readonly AssistantEvent[],
    // Any handler at all: its args, failures and production are no part of what it answered.
    handler: Rpc<Value, never, unknown, unknown>,
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
