import type { AssistantMessage } from './AssistantEvent.ts'
import { callsOf } from './callsOf.ts'
import type { Rpc } from './rpc.ts'

/**
 * What every call to `handler` in `messages` answered, in order — a failed call's, and one that
 * answered no value, left out. 44.51. For a conversation outside `chat`, a stored one read on a
 * server say; inside one, `calls` reads the same calls live.
 *
 * A call is the handler's by the tool name its MCP surface lists it under (20.13, 20.24).
 */
export function resultsOf<Value>(
    messages: readonly AssistantMessage[],
    // Any `Rpc`, whatever its `Args`: only the value is read off its call.
    handler: ((...args: never) => Promise<Value> | AsyncIterable<Value>) &
        Pick<Rpc<Value, never>, 'tool'>,
): Value[] {
    const values: Value[] = []
    for (const call of callsOf<unknown, Value>(messages, handler.tool, false))
        if (call.value !== undefined) values.push(call.value)
    return values
}
