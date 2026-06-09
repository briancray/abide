/* The subset of Claude message shapes both engines read. The SDK's query()
stream and the CLI's `--output-format stream-json` lines carry the same schema,
so one mapper (framesFromMessages) serves both. Loosely typed — only the fields
the mapping touches; each engine casts its raw source to this at the boundary. */
export type StreamMessage =
    | { type: 'stream_event'; event: { type: string; delta?: { type: string; text?: string } } }
    | {
          type: 'assistant'
          message: { content: Array<{ type: string; id?: string; name?: string; input?: unknown }> }
      }
    | { type: 'user'; message: { content: unknown } }
    | { type: 'result'; subtype: string }
