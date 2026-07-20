// Text helpers shared by the agent engines (claudeEngine / claudeCodeEngine) for flattening neutral
// message content and coercing arbitrary tool-result values into a string payload.

import type { NeutralContentPart } from './agentTypes.ts'

// Flatten a neutral message's content to plain text — a bare string passes through; a part list keeps
// only its `text` parts, newline-joined.
export function collectText(content: string | NeutralContentPart[]): string {
    if (typeof content === 'string') return content
    const parts: string[] = []
    for (const part of content) {
        if (part.type === 'text') parts.push(part.text)
    }
    return parts.join('\n')
}

// Coerce an arbitrary value into a string for a tool-result payload: strings pass through, Errors
// yield their message, everything else is JSON-stringified (falling back to String() on failure).
export function stringify(value: unknown): string {
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.message
    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}
