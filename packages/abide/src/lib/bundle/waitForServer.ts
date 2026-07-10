/*
Polls an HTTP URL until it answers (any status) or the deadline passes.
The spawned server child binds asynchronously, so the launcher can't open
the webview until a request round-trips. A connection refusal throws and
is swallowed; once Bun.serve is listening the fetch resolves and we
return. Throws on timeout so the launcher can report a failed boot rather
than open a blank window.
*/
export async function waitForServer(
    url: string,
    { timeoutMs = 10_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
    const deadline = Bun.nanoseconds() + timeoutMs * 1e6
    while (Bun.nanoseconds() < deadline) {
        try {
            /* Bound each probe by the time left to the deadline: a connection that is accepted but
               stalls its HTTP response leaves a bare `fetch(url)` pending forever (it never rejects),
               which would hang the loop past its own timeout. The abort caps a single hung probe at
               the remaining budget so the deadline is always honored. */
            const remainingMs = Math.max(0, (deadline - Bun.nanoseconds()) / 1e6)
            await fetch(url, { signal: AbortSignal.timeout(remainingMs) })
            return
        } catch {
            await Bun.sleep(intervalMs)
        }
    }
    throw new Error(`[abide] server did not become ready at ${url} within ${timeoutMs}ms`)
}
