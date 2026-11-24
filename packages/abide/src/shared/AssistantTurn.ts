// 53.24-53.30 — a conversation as a chat holds it: `transcript` folds an answer's events into one.

import type { AssistantContent } from './AssistantEvent.ts'

/** One turn of a conversation as a chat holds it: who spoke, and what they said in order. */
export type AssistantTurn = {
    /** Who spoke: the visitor at the composer, or the assistant answering. */
    role: 'user' | 'assistant'
    /** What the turn holds, in the order it arrived. */
    parts: AssistantTurnPart[]
    /** Why the answer ended, as its `done` event names it (`end_turn`), or `stopped`; `undefined` while it runs. */
    stop_reason: string | undefined
    /** The message the answer failed with, or `undefined`. */
    failed: string | undefined
}

/**
 * One piece of a turn, each the Messages API's block where it is one: words, with what they cite; an
 * image, a document or a search result; a tool call joined with what it answered; or a permission
 * prompt.
 */
export type AssistantTurnPart =
    /**
     * Words, every `text` event of a run joined — a cited run its own part, with its citations — or an
     * image, a document or a search result the visitor's turn carried, as `userMessage` makes it, a
     * search result shown by no part of its own.
     */
    | Extract<
          AssistantContent,
          { type: 'text' | 'image' | 'document' | 'search_result' }
      >
    | {
          type: 'tool'
          /** The call's id, which its `input` and `result` events name: the `tool_use` block's `id`. */
          id: string
          /** The tool, as the app's MCP surface lists it. */
          name: string
          /** What the model called it with, once written; `undefined` before. */
          input: unknown
          /** What it answered, as text, the `tool_result` block's `content`; `undefined` while it runs. */
          content: string | undefined
          /** Whether it answered with a failure, the `tool_result` block's `is_error`. */
          is_error: boolean
          /** What a handler of the app answered, as JSON, where one did. */
          value: unknown
      }
    | {
          type: 'permission'
          /** The prompt's id, which the answer names. */
          id: string
          /** The tool asking to run. */
          name: string
          /** What it would run with. */
          input: unknown
          /** The visitor's answer; `undefined` while it waits. */
          allowed: boolean | undefined
      }
