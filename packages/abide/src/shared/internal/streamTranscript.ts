// SYNCHRONOUS TRANSCRIPT ACCESS for a warm stream cursor (attach-hydration of `{#for await}`).
//
// A `seedStream`-warmed slot hands each reader a fresh cursor over the shared `ReplayableStream`, and the
// bare read is a `Promise` even though nothing is pending. Attach-hydration must bind each streamed item's
// VALUE synchronously to claim the server-rendered nodes for it — a promise can't be read synchronously,
// and the cursor only yields asynchronously. So the cursor carries a reference to the already-known
// transcript, exactly as it already carries its wire encoding (`responseSource.tagStreamEncoding`).
//
// Runtime-only marker (a symbol property); the public type stays a clean `AsyncIterable<T>`. A cold /
// non-memo iterable carries nothing and correctly falls back to the create path.

const STREAM_TRANSCRIPT: unique symbol = Symbol.for('abide.streamTranscript')

// Point `cursor` at the live transcript array backing it. The array is the stream's own — NOT a copy — so
// a later read sees chunks appended after the tag, which is what lets a claim decide how far the server
// actually got.
export function tagStreamTranscript(
    cursor: AsyncIterable<unknown>,
    chunks: readonly unknown[],
): void {
    Object.defineProperty(cursor, STREAM_TRANSCRIPT, {
        value: chunks,
        enumerable: false,
        configurable: true,
    })
}

// The transcript behind a tagged cursor, or undefined (cold stream / not a tagged cursor).
export function streamTranscriptOf(value: unknown): readonly unknown[] | undefined {
    if (value === null || typeof value !== 'object') return undefined
    return (value as { [STREAM_TRANSCRIPT]?: readonly unknown[] })[STREAM_TRANSCRIPT]
}
