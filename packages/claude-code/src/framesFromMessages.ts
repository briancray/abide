import type { AgentFrame } from '@belte/belte/server/agent'
import type { StreamMessage } from './StreamMessage.ts'

/*
Maps a Claude message stream to belte AgentFrames. Shared by both engines — the
SDK's query() stream and the CLI's stream-json lines have the same schema, so the
discrimination lives here once. Text is emitted from `stream_event` deltas (live
tokens); the complete `assistant` message repeats that text in full, so it's kept
only for its fully-formed tool_use blocks (partial tool inputs mid-stream aren't
valid JSON yet). Tool outcomes return as tool_result blocks on a user turn —
`ok: !is_error` surfaces a blocked/denied tool the same as a failed one.
*/
export async function* framesFromMessages(
    messages: AsyncIterable<StreamMessage>,
): AsyncIterable<AgentFrame> {
    // tool_use id → name, so a tool_result (which carries only the id) can name its call.
    const toolNames = new Map<string, string>()
    for await (const message of messages) {
        if (message.type === 'stream_event') {
            const { event } = message
            if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta' &&
                event.delta.text
            ) {
                yield { type: 'text', delta: event.delta.text }
            }
        } else if (message.type === 'assistant') {
            for (const block of message.message.content) {
                if (block.type === 'tool_use' && block.id && block.name) {
                    toolNames.set(block.id, block.name)
                    yield { type: 'tool_use', id: block.id, name: block.name, input: block.input }
                }
            }
        } else if (message.type === 'user') {
            const { content } = message.message
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'tool_result') {
                        yield {
                            type: 'tool_result',
                            id: block.tool_use_id,
                            name: toolNames.get(block.tool_use_id) ?? '',
                            ok: !block.is_error,
                        }
                    }
                }
            }
        } else if (message.type === 'result') {
            // `success` is a clean finish; every error subtype is an abnormal stop.
            yield { type: 'done', stop: message.subtype === 'success' ? 'end' : 'error' }
        }
    }
}
