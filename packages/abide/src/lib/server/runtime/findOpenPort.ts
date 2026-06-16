import { listenOnOpenPort } from './listenOnOpenPort.ts'

/*
Returns the first bindable TCP port at or above `start`, probing upward.
Used when no PORT is configured so the server lands on a predictable
3000+ port (3000, then 3001, …) instead of a random kernel-assigned one —
running a second app just steps to the next free port. The scan policy
(range, kernel-assigned fallback) lives in listenOnOpenPort; this variant
binds a throwaway server and releases it, so like any release-then-rebind
there's a tiny race before the real listener takes the port — negligible
for a local boot.
*/
export function findOpenPort(start: number): number {
    const probe = listenOnOpenPort(
        (port) => Bun.serve({ port, fetch: () => new Response() }),
        start,
    )
    const bound = probe.port as number
    probe.stop(true)
    return bound
}
