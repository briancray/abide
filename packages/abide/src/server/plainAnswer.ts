/**
 * A plain-text answer at `status`, never stored.
 *
 * 21.3 — A REFUSAL ABIDE ANSWERS AS TEXT, typed. `stamp` rebuilds an answer to give it a reason
 * phrase (17.8), and a string body rebuilt goes out as `application/octet-stream`.
 *
 * 21.1 — `nosniff` HERE TOO, though `stamp` sets it on whatever an app answers: `abide dev`'s
 * listener answers with this where no app stands behind it, and nothing stamps those.
 */
export function plainAnswer(message: string, status: number): Response {
    return new Response(message, {
        status,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
        },
    })
}
