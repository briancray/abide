import { error } from '../error.ts'

/*
Bounds a verb handler's execution: races the in-flight `work` against `ms`.
On the deadline it resolves a 504 — so the caller (an SSR cache read, an
MCP/CLI invocation, or the network response) is unblocked in time with an
honest status — and calls `onTimeout` to cancel any
cooperating outbound work (the network path composes the verb's deadline into
request().signal; see defineVerb).

`work` keeps running after the deadline — JS can't cancel a running async
function, only stop awaiting it — so its eventual settlement is swallowed to
avoid an unhandled rejection, and a late-resolved streaming Response has its
body cancelled to release the underlying source. A handler that wants its own
outbound I/O torn down should pass request().signal to it.
*/
export function runWithVerbTimeout(
    work: Promise<Response>,
    ms: number,
    onTimeout: () => void,
): Promise<Response> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const deadline = new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
            timedOut = true
            onTimeout()
            resolve(error(504, 'handler timeout'))
        }, ms)
    })
    return (async () => {
        try {
            return await Promise.race([work, deadline])
        } finally {
            clearTimeout(timer)
            if (timedOut) {
                // The race already returned a 504. Swallow a late rejection, and
                // cancel a late-resolved streaming Response's body so its source
                // (DB cursor, file handle) is released rather than leaked.
                void work.then(
                    (late) => {
                        void late.body?.cancel()
                    },
                    () => {},
                )
            }
        }
    })()
}
