// SECTION 44 — WHAT A CONVERSATION IS MADE OF, on both sides: the messages a page holds and sends,
// and the events `assistant` streams back to it — each as the Messages API has it. Types alone, so
// the browser names what `ask()` hands it without reaching for the server's entry.

/** Where the API caches the prompt up to a block: the Messages API's `cache_control`. */
type CacheControl = { type: 'ephemeral'; ttl?: '5m' | '1h' | undefined }

/** Words, and the citations an answer's words carry back. */
type TextBlock = {
    type: 'text'
    text: string
    citations?: Record<string, unknown>[] | undefined
    cache_control?: CacheControl | undefined
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
    transformations?:
        { oversized_image?: 'downsize' | 'error' | undefined } | undefined
    cache_control?: CacheControl | undefined
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
    title?: string | undefined
    context?: string | undefined
    citations?: { enabled: boolean } | undefined
    cache_control?: CacheControl | undefined
}

type SearchResultBlock = {
    type: 'search_result'
    source: string
    title: string
    content: TextBlock[]
    citations?: { enabled: boolean } | undefined
    cache_control?: CacheControl | undefined
}

/**
 * A piece of a turn, as the Messages API's content block for it: words, with the citations an
 * answer's carry; an image as base64, at a URL, or an uploaded file; a document — a PDF as base64 or
 * at a URL, text, content of its own, or an uploaded file — with its title, its context and whether
 * answers cite it; a search result whose text an answer may cite; a tool call the model made, and
 * what it reasoned, in its own turn; what a call answered, in the user turn after it; and a block
 * the API's own tools write into the model's turn — a server tool's call and result, an MCP
 * connector's, a compaction, a fallback — which goes back as it came.
 *
 * A BLOCK THE MODEL WRITES TAKES ANY FIELD THE API ADDS (a call's `caller`): the API binds a thinking
 * block to the turns before it, so a turn sent back with a field taken off is one it may refuse.
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
          cache_control?: CacheControl | undefined
          [field: string]: unknown
      }
    | {
          type: 'tool_result'
          tool_use_id: string
          content?:
              | string
              | (TextBlock | ImageBlock | DocumentBlock | SearchResultBlock)[]
              | undefined
          is_error?: boolean | undefined
          cache_control?: CacheControl | undefined
      }
    | {
          type: 'thinking'
          thinking: string
          signature: string
          [field: string]: unknown
      }
    | { type: 'redacted_thinking'; data: string; [field: string]: unknown }
    | {
          type: 'server_tool_use' | 'mcp_tool_use'
          id: string
          name: string
          input: unknown
          [field: string]: unknown
      }
    | {
          type:
              | 'web_search_tool_result'
              | 'web_fetch_tool_result'
              | 'code_execution_tool_result'
              | 'bash_code_execution_tool_result'
              | 'text_editor_code_execution_tool_result'
              | 'tool_search_tool_result'
              | 'advisor_tool_result'
              | 'mcp_tool_result'
          tool_use_id: string
          content?: unknown
          is_error?: boolean | undefined
          [field: string]: unknown
      }
    | { type: 'compaction' | 'fallback'; [field: string]: unknown }

/** One turn of a conversation, as the Messages API takes it: its words, or its blocks in order. */
export type AssistantMessage = {
    role: 'user' | 'assistant'
    content: string | AssistantContent[]
}

/** What a request used, as the Messages API counts it, and whatever else the provider reports. */
export type AssistantUsage = {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number | null | undefined
    cache_read_input_tokens?: number | null | undefined
    [field: string]: unknown
}

/**
 * What a conversation yields, the same from every provider: each run of the model as the Messages
 * API streams it, event for event, and between runs what abide alone knows — what a tool call
 * answered, with its value read as JSON where the app's handler answers one, and a permission prompt
 * Claude Code asks the page. 44.2, 44.11.
 */
export type AssistantEvent =
    | {
          type: 'message_start'
          message: {
              id: string
              type: 'message'
              role: 'assistant'
              model: string
              content: AssistantContent[]
              stop_reason: string | null
              stop_sequence: string | null
              usage: AssistantUsage
          }
      }
    | {
          type: 'content_block_start'
          index: number
          content_block: AssistantContent
      }
    | {
          type: 'content_block_delta'
          index: number
          delta:
              | { type: 'text_delta'; text: string }
              | { type: 'input_json_delta'; partial_json: string }
              | { type: 'citations_delta'; citation: Record<string, unknown> }
              | { type: 'thinking_delta'; thinking: string }
              | { type: 'signature_delta'; signature: string }
      }
    | { type: 'content_block_stop'; index: number }
    | {
          type: 'message_delta'
          delta: { stop_reason: string | null; stop_sequence: string | null }
          // The run's usage so far, which names its output and may name the rest.
          usage: {
              output_tokens: number
              input_tokens?: number | null | undefined
              cache_creation_input_tokens?: number | null | undefined
              cache_read_input_tokens?: number | null | undefined
              [field: string]: unknown
          }
      }
    | { type: 'message_stop' }
    | { type: 'ping' }
    | {
          type: 'tool_result'
          tool_use_id: string
          content: (TextBlock | ImageBlock)[]
          is_error: boolean
          value: unknown
      }
    | { type: 'permission'; id: string; name: string; input: unknown }
