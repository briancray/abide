import type { HttpVerb } from '../../shared/types/HttpVerb.ts'

/*
Per-command manifest entry baked into the standalone CLI binary by the
bundler. Carries enough info to make the right HTTP request without
importing the handler module (which the thin build doesn't ship). Covers
both rpcs and socket commands — a socket `tail` is a GET against
`/__abide/sockets/<name>` with `accept: text/event-stream` so the CLI
streams it live; a socket `publish` is a POST to the same path.
*/
export type CliManifestEntry = {
    method: HttpVerb
    url: string
    jsonSchema?: Record<string, unknown>
    // Request Accept header. Socket tail sets text/event-stream to stream live frames.
    accept?: string
}
