// 44.51, 53.109 — THE CALLS A CONVERSATION MADE TO ONE HANDLER, found by the tool its surface lists it
// under (20.13, 20.24) and read as they stand: what each was handed, what it answered, and whether it
// failed or is still running. One reading, so `chat`'s `calls` and `resultsOf` cannot disagree on
// which calls are a handler's or on what one answered.

import type { AssistantContent, AssistantMessage } from './AssistantEvent.ts'
import { deliveredValue } from './MessageAccumulator.ts'
import { parsedJson } from './parsedJson.ts'
import { wordsOf } from './wordsOf.ts'

type ToolUse = Extract<AssistantContent, { type: 'tool_use' }>
type ToolResult = Extract<AssistantContent, { type: 'tool_result' }>

/** One call to a handler in a conversation: the block making it, what it was handed, what it answered, and how it stands. */
export type ChatCall<Input, Value> = {
    /** The `tool_use` block making the call. */
    readonly toolUse: ToolUse
    /** What the call was handed: its block's `input`, as it stands while its JSON streams in. */
    readonly input: Input
    /** 44.106 — what it answered, `undefined` while it runs and where it failed or answered no value. */
    readonly value: Value | undefined
    /** The `tool_result` block answering the call, `undefined` while it runs. */
    readonly toolResult: ToolResult | undefined
    /** Whether its result is an error. */
    readonly failed: boolean
    /** Whether an answer is streaming and nothing has answered the call yet. */
    readonly streaming: boolean
}

/**
 * Every call in `messages` to the handler listed as `tool`, in order — `streaming` where the answer
 * they belong to still is. None where the handler is listed under no tool.
 */
export function callsOf<Input, Value>(
    messages: readonly AssistantMessage[],
    tool: string | undefined,
    streaming: boolean,
): ChatCall<Input, Value>[] {
    const calls: ChatCall<Input, Value>[] = []
    if (tool === undefined) return calls
    const uses: ToolUse[] = []
    const results = new Map<string, ToolResult>()
    for (const message of messages) {
        if (typeof message.content === 'string') continue
        for (const block of message.content)
            if (block.type === 'tool_use' && block.name === tool)
                uses.push(block)
            else if (block.type === 'tool_result')
                results.set(block.tool_use_id, block)
    }
    for (const toolUse of uses) {
        const toolResult = results.get(toolUse.id)
        const failed = toolResult?.is_error === true
        calls.push({
            toolUse,
            input: toolUse.input as Input,
            value:
                toolResult === undefined || failed
                    ? undefined
                    : (valueOf(toolResult) as Value | undefined),
            toolResult,
            failed,
            streaming: streaming && toolResult === undefined,
        })
    }
    return calls
}

// 44.106 — the value its event delivered; a block no event was folded into (a conversation stored and
// read back) answers its words read as JSON.
function valueOf(block: ToolResult): unknown {
    const kept = deliveredValue(block)
    return kept === undefined ? parsedJson(wordsOf(block.content)) : kept.value
}
