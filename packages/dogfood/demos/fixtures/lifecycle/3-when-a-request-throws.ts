/**
 * The fourth hook, and the only one that runs on a path nobody planned.
 *
 * It answers rather than logs-and-rethrows: what it returns IS the response, so an app decides what a
 * caller sees. Returning nothing falls through to abide's own answer, which is the right arm for the
 * errors this hook was not written for.
 *
 * An app EXPORT rather than a call, the same form the three hooks above it take — and this exact hook
 * is on `packages/dogfood/app.ts`, which is why the preview beside it gets a 400 back instead of the
 * 500 an unplanned throw would otherwise be.
 */
export function onError(thrown: unknown): Response | undefined {
    if (thrown instanceof RangeError) {
        return new Response('that number is out of range', { status: 400 })
    }
    return undefined
}
