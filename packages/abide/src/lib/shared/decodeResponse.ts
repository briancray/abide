import { bodyValueForKind } from './bodyValueForKind.ts'
import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'
import { DEFER } from './DEFER.ts'
import { httpErrorFor } from './httpErrorFor.ts'

/*
Decodes a Response into the natural body value based on Content-Type:
  application/json (or `*\/+json`) → parsed JSON
  text/*                           → string
  204 No Content                   → undefined
  everything else                  → Blob

Non-2xx responses throw HttpError so the happy path never has to check
`.ok` — error handling moves into try/catch (or unhandled exception
propagation), and the success path types as Promise<Return> cleanly.

Streaming Content-Types (SSE / JSONL / NDJSON) throw a clear error
rather than silently doing the wrong thing: response.text() would hang
forever on a never-ending body and response.json() would fail mid-parse.
A streaming rpc's bare call already returns a Subscribable (the type makes
`await fn(args)` a compile error), so this is a backstop for the paths that
still decode a raw Response — `cache()` and the one-shot stream reader. The
error points callers at the right tools: `state(fn(args))` for a reactive
view, or `for await (… of fn(args))` for direct iteration.

Callers that need headers, streaming, or per-status branching should use
the `.raw(args)` escape hatch on the remote function instead — that
returns the underlying Response untouched.
*/
export async function decodeResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
        throw await httpErrorFor(response)
    }
    if (response.status === 204) {
        return undefined
    }
    const contentType = contentTypeOf(response.headers)
    const kind = contentBodyKind(contentType)
    if (kind === 'streaming') {
        throw new Error(
            `[abide] response at ${response.url} is a stream (${contentType}) — a streaming rpc's bare call already returns a Subscribable: use state(fn(args)) for a reactive view or \`for await (… of fn(args))\` for iteration, not await/cache()`,
        )
    }
    /* json/text go through the shared mapping warmValueFromSnapshot also uses, so a warm
       seed reads byte-identically to this live read; binary (the only DEFER kind left,
       streaming already threw above) blobs. */
    const value = bodyValueForKind(
        kind,
        () => response.json(),
        () => response.text(),
    )
    return value === DEFER ? response.blob() : value
}
