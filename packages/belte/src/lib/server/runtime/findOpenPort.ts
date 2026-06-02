// Ports probed upward from `start` before giving up and letting the kernel assign one.
const SCAN_RANGE = 100

/*
Returns the first bindable TCP port at or above `start`, probing upward.
Used when no PORT is configured so the server lands on a predictable
3000+ port (3000, then 3001, …) instead of a random kernel-assigned one —
running a second app just steps to the next free port. Each probe binds a
throwaway server and stops it; like any release-then-rebind there's a tiny
race before the real listener takes the port, negligible for a local boot.
After SCAN_RANGE occupied ports it gives up scanning and lets the kernel
assign any free port (bind to 0).
*/
export function findOpenPort(start: number): number {
    for (let port = start; port < start + SCAN_RANGE; port++) {
        try {
            return bindAndRelease(port)
        } catch {
            // port in use — try the next one up
        }
    }
    // every candidate was taken; bind to 0 so the kernel picks a free port
    return bindAndRelease(0)
}

/*
Binds a throwaway server to `port` (0 = let the kernel assign one), reads the
actual bound port, and releases it. Throws if the port is already in use.
*/
function bindAndRelease(port: number): number {
    const probe = Bun.serve({ port, fetch: () => new Response() })
    const bound = probe.port as number
    probe.stop(true)
    return bound
}
