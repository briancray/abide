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
            await fetch(url)
            return
        } catch {
            await Bun.sleep(intervalMs)
        }
    }
    throw new Error(`[abide] server did not become ready at ${url} within ${timeoutMs}ms`)
}
