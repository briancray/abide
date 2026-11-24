// 53.24-53.30 — a conversation as a chat holds it: `transcript` folds an answer's events into one.

import type { AssistantContent } from './AssistantEvent.ts'

/** One turn of a conversation as a chat holds it: who spoke, and what they said in order. */
export type AssistantTurn = {
    /** Who spoke: the visitor at the composer, or the assistant answering. */
    role: 'user' | 'assistant'
    /** What the turn holds, in the order it arrived. */
    parts: AssistantTurnPart[]
    /** Why the answer ended, as its `done` event names it (`end_turn`), or `stopped`; `undefined` while it runs. */
    stop: string | undefined
    /** The message the answer failed with, or `undefined`. */
    failed: string | undefined
}

/** One piece of a turn: words, an image, a document, a tool call, or a permission prompt. */
export type AssistantTurnPart =
    | {
          type: 'text'
          /** The words, every `text` event of a run joined. */
          text: string
      }
    /** An image or a document the visitor attached, as `userMessage` makes it. */
    | Extract<AssistantContent, { type: 'image' | 'document' }>
    | {
          type: 'tool'
          /** The call's id, which its `input` and `result` events name. */
          id: string
          /** The tool, as the app's MCP surface lists it. */
          name: string
          /** What the model called it with, once written; `undefined` before. */
          input: unknown
          /** What it answered, as text; `undefined` while it runs. */
          result: string | undefined
          /** Whether it answered with a failure. */
          failed: boolean
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
