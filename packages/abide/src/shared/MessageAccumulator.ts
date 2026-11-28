// 44.105 — THE MESSAGES A STREAM OF EVENTS AMOUNTS TO, accumulated as the Messages API's own clients
// accumulate its stream: each run's `message_start` opens an assistant message, a block starts where
// `content_block_start` says, its deltas extend it in place, and a tool call's input is its JSON once
// the block stops. Between runs, what a call answered goes into the user message after the call.
//
// A BLOCK IS WRITTEN AS THE API STREAMED IT, every field it came with: the API binds a thinking
// block to the turns before it, so a turn sent back with a field taken off is one it may refuse.
// Each block follows the run's last, whatever index the stream gave it, so a run is never left with
// a hole in it.
//
// ONE EVENT AT A TIME, IN PLACE: a delta extends the block it lands in and touches nothing before it,
// so a page folding a streaming answer pays per event for that event alone, and a block keeps its
// identity from its first delta to its last (53.32). `assistantMessage` folds a whole answer the same
// way, `chat` an answer as it streams, and `provider.claudeApi` its own history between runs.

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from './AssistantEvent.ts'

/** A block as it is written: any of the API's, by its fields, which its deltas fill in. */
type Writing = { type: string; [field: string]: unknown }

/** `block` as a block of its own to write into, its citations a list of its own. */
function writtenOf(block: AssistantContent): Writing {
    const written: Writing = { ...block }
    // So a citation added never lands in the event's.
    if (Array.isArray(written.citations))
        written.citations = [...written.citations]
    return written
}

// 44.106 — THE VALUE EACH `tool_result` EVENT DELIVERED (44.49), by the block it was folded into: the
// block goes back to the API as the API takes it, so the value is kept beside it rather than on it,
// and what a call answered is read from here rather than from its words read again as JSON.
const delivered = new WeakMap<AssistantContent, unknown>()

/** The value the `tool_result` event folded into `block` delivered, and `undefined` where no event was. */
export function deliveredValue(
    block: AssistantContent,
): { value: unknown } | undefined {
    return delivered.has(block) ? { value: delivered.get(block) } : undefined
}

/** Whether `block` is a call the model made: to an app's tool, a server tool or an MCP server. */
export function makesCall(
    block: AssistantContent,
): block is Extract<
    AssistantContent,
    { type: 'tool_use' | 'server_tool_use' | 'mcp_tool_use' }
> {
    return (
        block.type === 'tool_use' ||
        block.type === 'server_tool_use' ||
        block.type === 'mcp_tool_use'
    )
}

/** Whether `block` answers a call: a `tool_result`, or a server tool's or an MCP server's result. */
export function answersCall(
    block: AssistantContent,
): block is Extract<AssistantContent, { tool_use_id: string }> {
    return 'tool_use_id' in block && typeof block.tool_use_id === 'string'
}

/** Folds an answer's events, one at a time, into the messages they amount to. */
export class MessageAccumulator {
    /** Where in the messages the answer begins: what `settle` reads from. */
    readonly start: number
    // Where in the messages the run being written stands. ITS BLOCKS ARE REACHED THROUGH THE
    // MESSAGES EACH EVENT IS FOLDED INTO, never through a reference kept: a page folds inside a
    // `patch`, which sees a write made through what it handed over, and no other.
    #run: number | undefined = undefined
    // Each tool call's input as its JSON arrives, by block index.
    #partials: string[] = []
    // Where in the run each block index was written.
    #places: number[] = []

    /** @param start how many messages come before the answer */
    constructor(start: number) {
        this.start = start
    }

    /** Folds `event` into `messages`, in place. 44.105. */
    add(messages: AssistantMessage[], event: AssistantEvent): void {
        switch (event.type) {
            case 'message_start': {
                const content: AssistantContent[] = []
                for (const block of event.message.content)
                    content.push(writtenOf(block) as AssistantContent)
                messages.push({ role: 'assistant', content })
                this.#run = messages.length - 1
                this.#partials = []
                this.#places = []
                return
            }
            case 'content_block_start': {
                // A block is written within a run, which `message_start` opened.
                const run = this.#blocks(messages)
                if (run === undefined) return
                this.#partials[event.index] = ''
                this.#places[event.index] = run.length
                run.push(writtenOf(event.content_block))
                return
            }
            case 'content_block_delta': {
                const block = this.#block(messages, event.index)
                if (block === undefined) return
                const delta = event.delta
                if (delta.type === 'text_delta')
                    block.text = String(block.text ?? '') + delta.text
                else if (delta.type === 'citations_delta') {
                    if (Array.isArray(block.citations))
                        block.citations.push(delta.citation)
                    else block.citations = [delta.citation]
                } else if (delta.type === 'input_json_delta')
                    this.#partials[event.index] =
                        (this.#partials[event.index] ?? '') + delta.partial_json
                else if (delta.type === 'thinking_delta')
                    block.thinking =
                        String(block.thinking ?? '') + delta.thinking
                else block.signature = delta.signature
                return
            }
            case 'content_block_stop': {
                const block = this.#block(messages, event.index)
                const partial = this.#partials[event.index] ?? ''
                if (block === undefined || partial === '') return
                // Cut short at `max_tokens`, an input is not JSON, and is kept as the words written.
                try {
                    block.input = JSON.parse(partial)
                } catch {
                    block.input = partial
                }
                return
            }
            case 'message_stop':
                this.#run = undefined
                return
            case 'tool_result': {
                const answered: AssistantContent = {
                    type: 'tool_result',
                    tool_use_id: event.tool_use_id,
                    content: event.content,
                    is_error: event.is_error,
                }
                delivered.set(answered, event.value)
                // 44.12 — every result of one run in one user message.
                const last = messages[messages.length - 1]
                if (last !== undefined && answersOnly(last))
                    (last.content as AssistantContent[]).push(answered)
                else messages.push({ role: 'user', content: [answered] })
                return
            }
        }
    }

    /**
     * Leaves out of the answer what the API would refuse sent back: a call that never answered — an
     * app's tool's, a server tool's or an MCP server's, the turn cap reached or the answer stopped
     * while it ran — a thinking block no signature
     * reached, and a message left with nothing in it. 44.105.
     */
    settle(messages: AssistantMessage[]): void {
        this.#run = undefined
        const answered = new Set<string>()
        for (let at = this.start; at < messages.length; at++) {
            const content = (messages[at] as AssistantMessage).content
            if (typeof content !== 'string')
                for (const block of content)
                    if (answersCall(block)) answered.add(block.tool_use_id)
        }
        for (let at = messages.length - 1; at >= this.start; at--) {
            const message = messages[at] as AssistantMessage
            if (
                message.role !== 'assistant' ||
                typeof message.content === 'string'
            )
                continue
            const kept: AssistantContent[] = []
            for (const block of message.content)
                if (
                    makesCall(block)
                        ? answered.has(block.id)
                        : block.type !== 'thinking' || Boolean(block.signature)
                )
                    kept.push(block)
            if (kept.length === 0) messages.splice(at, 1)
            else if (kept.length < message.content.length)
                message.content = kept
        }
    }

    /** The block the run being written holds for stream index `index`, where one was written. */
    #block(messages: AssistantMessage[], index: number): Writing | undefined {
        const place = this.#places[index]
        return place === undefined ? undefined : this.#blocks(messages)?.[place]
    }

    /** The blocks of the run being written, as `messages` holds them: the API's own, filled in by deltas. */
    #blocks(messages: AssistantMessage[]): Writing[] | undefined {
        return this.#run === undefined
            ? undefined
            : (messages[this.#run]?.content as unknown as Writing[] | undefined)
    }
}

/** Whether `message` is the user message holding a run's tool results, and nothing else. */
function answersOnly(message: AssistantMessage): boolean {
    if (message.role !== 'user' || typeof message.content === 'string')
        return false
    for (const block of message.content)
        if (block.type !== 'tool_result') return false
    return message.content.length > 0
}
