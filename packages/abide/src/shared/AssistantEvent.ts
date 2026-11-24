// SECTION 44 — WHAT A CONVERSATION IS MADE OF, on both sides: the transcript a page sends and the
// events `assistant` yields back to it. Types alone, so the browser names what `ask()` hands it
// without reaching for the server's entry.

import type { Method } from './rpc.ts'

/** Where the API caches the prompt up to a block: the Messages API's `cache_control`. */
type CacheControl = { type: 'ephemeral'; ttl?: '5m' | '1h' }

/** Words, and the citations an answer's words carry back. */
type TextBlock = {
    type: 'text'
    text: string
    citations?: Record<string, unknown>[]
    cache_control?: CacheControl
}

type ImageBlock = {
    type: 'image'
    source:
        | {
              type: 'base64'
              media_type:
                  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
              data: string
          }
        | { type: 'url'; url: string }
        | { type: 'file'; file_id: string }
    transformations?: { oversized_image?: 'downsize' | 'error' }
    cache_control?: CacheControl
}

type DocumentBlock = {
    type: 'document'
    source:
        | { type: 'base64'; media_type: 'application/pdf'; data: string }
        | { type: 'text'; media_type: 'text/plain'; data: string }
        | {
              type: 'content'
              content: string | (TextBlock | ImageBlock)[]
          }
        | { type: 'url'; url: string }
        | { type: 'file'; file_id: string }
    title?: string
    context?: string
    citations?: { enabled: boolean }
    cache_control?: CacheControl
}

type SearchResultBlock = {
    type: 'search_result'
    source: string
    title: string
    content: TextBlock[]
    citations?: { enabled: boolean }
    cache_control?: CacheControl
}

/**
 * A piece of a turn, as the Messages API's content block for it: words, with the citations an
 * answer's carry; an image as base64, at a URL, or an uploaded file; a document — a PDF as base64 or
 * at a URL, text, content of its own, or an uploaded file — with its title, its context and whether
 * answers cite it; a search result whose text an answer may cite; a tool call the model made, in its
 * own turn; and what that call answered, in the user turn after it.
 */
export type AssistantContent =
    | TextBlock
    | ImageBlock
    | DocumentBlock
    | SearchResultBlock
    | {
          type: 'tool_use'
          id: string
          name: string
          input: unknown
          cache_control?: CacheControl
      }
    | {
          type: 'tool_result'
          tool_use_id: string
          content?:
              | string
              | (TextBlock | ImageBlock | DocumentBlock | SearchResultBlock)[]
          is_error?: boolean
          cache_control?: CacheControl
      }

/** One turn of the transcript, as the Messages API takes it: its words, or its blocks in order. */
export type AssistantMessage = {
    role: 'user' | 'assistant'
    content: string | AssistantContent[]
}

/**
 * What a conversation yields, the same from every provider, each field under the Messages API's name
 * for it where it has one: words, a cited run of them whole; a tool call as it starts, its input once
 * written, and its result; a permission prompt; and the end, with why and what it used.
 */
export type AssistantEvent =
    | { type: 'text'; text: string; citations?: Record<string, unknown>[] }
    | {
          type: 'tool'
          id: string
          name: string
          handler: { method: Method; address: string } | undefined
      }
    | { type: 'input'; id: string; input: unknown }
    | {
          type: 'result'
          tool_use_id: string
          content: string
          is_error: boolean
          handler: { method: Method; address: string } | undefined
          value: unknown
      }
    | { type: 'permission'; id: string; name: string; input: unknown }
    | {
          type: 'done'
          stop_reason: string
          usage: {
              input_tokens: number
              output_tokens: number
              cache_creation_input_tokens?: number
              cache_read_input_tokens?: number
              [field: string]: unknown
          }
      }
