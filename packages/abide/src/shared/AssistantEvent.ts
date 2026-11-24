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

/**
 * A piece of a turn, as the Messages API's content block for it, which a user turn may carry: words;
 * an image as base64, at a URL, or an uploaded file; a document — a PDF as base64 or at a URL, text,
 * content of its own, or an uploaded file — with its title, its context and whether answers cite it;
 * and a search result whose text an answer may cite.
 */
export type AssistantContent =
    | TextBlock
    | ImageBlock
    | {
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
    | {
          type: 'search_result'
          source: string
          title: string
          content: TextBlock[]
          citations?: { enabled: boolean }
          cache_control?: CacheControl
      }

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
