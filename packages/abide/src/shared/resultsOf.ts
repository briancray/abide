import type { AssistantMessage } from './AssistantEvent.ts'
import { unmounted } from './mount.ts'
import type { Reactive } from './reactive/Reactive.ts'
import type { Rpc } from './rpc.ts'
import { surfaceName } from './surfaceName.ts'

/**
 * What every call to `handler` in `messages` answered, in order, each its value read as JSON (44.49)
 * — a failed call's, and one whose words spell no JSON, left out. 44.51.
 *
 * A call is the handler's by the tool name its MCP surface lists it under (20.13).
 */
export function resultsOf<Value>(
    messages: readonly AssistantMessage[],
    // Any `Rpc`, whatever its `Args`: only the value is read off its call.
    handler: ((...args: never) => Reactive<Value, never, unknown, unknown>) &
        Pick<Rpc<Value, never>, 'method' | 'address'>,
): Value[] {
    const values: Value[] = []
    if (handler.address === undefined) return values
    const name = surfaceName(
        handler.method,
        unmounted(handler.address) ?? handler.address,
    )
    const calls = new Set<string>()
    for (const message of messages) {
        if (typeof message.content === 'string') continue
        for (const block of message.content)
            if (block.type === 'tool_use' && block.name === name)
                calls.add(block.id)
            else if (
                block.type === 'tool_result' &&
                block.is_error !== true &&
                calls.has(block.tool_use_id)
            ) {
                const value = valueOf(block.content)
                if (value !== undefined) values.push(value as Value)
            }
    }
    return values
}

/** A result's words as the JSON value they spell, or `undefined` where they spell none. */
function valueOf(content: unknown): unknown {
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content))
        for (const block of content)
            if (block?.type === 'text') text += block.text
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}
