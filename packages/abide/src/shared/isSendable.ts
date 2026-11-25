import type { AssistantContent } from './AssistantEvent.ts'

/** 44.38 — whether `block` holds something to send: a text block of whitespace alone, which the API refuses, does not. */
export function isSendable(block: AssistantContent): boolean {
    return block.type !== 'text' || /\S/.test(block.text)
}
