// SECTION 44 — WHAT A CONVERSATION IS MADE OF, on both sides: the transcript a page sends and the
// events `assistant` yields back to it. Types alone, so the browser names what `ask()` hands it
// without reaching for the server's entry.

import type { Method } from './rpc.ts'

/** A piece of a turn: words, or an image as base64 with its type. */
export type AssistantContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }

/** One turn of the transcript a caller sends: its words, or its pieces in order. */
export type AssistantMessage = {
    role: 'user' | 'assistant'
    content: string | AssistantContent[]
}

/** What a conversation yields, the same from every provider. */
export type AssistantEvent =
    | { type: 'text'; text: string }
    | {
          type: 'tool'
          id: string
          name: string
          handler: { method: Method; address: string } | undefined
      }
    | { type: 'input'; id: string; input: unknown }
    | {
          type: 'result'
          id: string
          text: string
          failed: boolean
          handler: { method: Method; address: string } | undefined
          value: unknown
      }
    | { type: 'permission'; id: string; name: string; input: unknown }
    | {
          type: 'done'
          stop: string
          usage: { input: number; output: number }
      }
