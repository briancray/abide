/*
Merges a caller's `ResponseInit` over a respond helper's default headers.
The helper's defaults seed the header set; the caller's headers overlay them
per-key (so an explicit `cache-control` wins over the helper's `no-store`),
and the rest of `init` (status, statusText) passes straight through. Shared
by `json` / `jsonl` / `sse` / `error` / `redirect` so every helper accepts a
final `ResponseInit` with identical override semantics.

A helper that owns the status itself (`error`, `redirect`) passes it as the
final `status` argument; it is applied last so it always wins over any
`init.status`, keeping that precedence inside the helper rather than relying
on each call site spreading in the right order.
*/
export function withResponseDefaults(
    init: ResponseInit | undefined,
    defaultHeaders: Record<string, string>,
    status?: number,
): ResponseInit {
    const headers = new Headers(defaultHeaders)
    new Headers(init?.headers).forEach((value, key) => {
        headers.set(key, value)
    })
    return { ...init, headers, ...(status !== undefined && { status }) }
}
