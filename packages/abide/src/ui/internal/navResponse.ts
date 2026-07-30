// WHAT A NAV FETCH CAME BACK AS — one classification, for every nav shape.
//
// A nav's response is one of exactly three things: the JSONL frame stream the soft-nav path reads, a
// middleware short-circuit's `{redirect}` envelope, or something this client cannot apply. Three call
// sites in `navigate.ts` asked that question — the partial cross-nav, the param/query confirm, and the
// full soft-nav — and each spelled the answer itself. They had already diverged three ways: two decoded
// the envelope as `await response.json().catch(() => null)` and tested `envelope?.redirect !== undefined
// && .length > 0`, the third used a `try`/`catch` and `typeof envelope.redirect === 'string'`.
//
// The ordering constraint is the part that must not be restated, and only one of the three carried it:
// `application/jsonl` CONTAINS `application/json` as a substring, so a `.includes('application/json')`
// asked first misclassifies the frame stream as a redirect envelope — a nav that renders nothing and
// hard-loads. The other two happened to get the order right, with nothing at either site saying it was
// load-bearing.
//
// What stays per-caller is the CONSEQUENCE of `unusable`, which genuinely differs: the param/query
// confirm returns and lets its live mount stand (the DOM is already correct — the confirm was for the
// middleware verdict and the fresh reads), while the other two hard-load, because they were going to
// replace DOM they have not replaced. Same predicate, different consequence — visible here rather than
// hidden in three copies.

export type NavResponse =
    // The soft-nav frame stream. `body` is non-null by construction — a `stream` verdict is only
    // returned when there is one to read, so callers never re-test it.
    | { kind: 'stream'; body: ReadableStream<Uint8Array> }
    // A middleware short-circuit: navigate to `to` instead (non-empty by construction).
    | { kind: 'redirect'; to: string }
    // A full HTML document, an error page, a bodyless response, a JSON envelope naming no redirect, or
    // a malformed one. Nothing here can be applied to a live mount.
    | { kind: 'unusable' }

// Reads the body when — and only when — the response is a JSON envelope, so a `stream` verdict hands
// the body on undrained.
export async function classifyNavResponse(response: Response): Promise<NavResponse> {
    const contentType = response.headers.get('content-type') ?? ''
    // `jsonl` FIRST — see the header: the substring relation makes the reverse order silently wrong.
    if (contentType.includes('application/jsonl')) {
        return response.body === null
            ? { kind: 'unusable' }
            : { kind: 'stream', body: response.body }
    }
    if (contentType.includes('application/json')) {
        const envelope = (await response.json().catch(() => null)) as { redirect?: unknown } | null
        const to = envelope?.redirect
        if (typeof to === 'string' && to.length > 0) return { kind: 'redirect', to }
    }
    return { kind: 'unusable' }
}
