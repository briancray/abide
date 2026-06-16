import type { Server } from 'bun'

// Ports tried upward from `start` before giving up and letting the kernel assign one.
const SCAN_RANGE = 100

/*
Binds the real server, scanning upward from `start` for the first free port.
The listener that wins a port is the one that keeps it: unlike probing a
throwaway server and releasing it before the real bind, this leaves no window
for the chosen port to be stolen in between — the gap that crashed boot on
EADDRINUSE instead of stepping to the next port. `bindAt` does the actual
Bun.serve; only an in-use port is retried, any other failure propagates. After
SCAN_RANGE occupied ports it binds port 0 so the kernel assigns any free port.
*/
export function listenOnOpenPort(
    bindAt: (port: number) => Server<unknown>,
    start: number,
): Server<unknown> {
    for (let port = start; port < start + SCAN_RANGE; port++) {
        try {
            return bindAt(port)
        } catch (error) {
            if (!isAddressInUse(error)) {
                throw error
            }
            // port in use — try the next one up
        }
    }
    // every candidate was taken; bind to 0 so the kernel picks a free port
    return bindAt(0)
}

// Bun reports a taken port as an Error carrying code 'EADDRINUSE'.
function isAddressInUse(error: unknown): boolean {
    return error instanceof Error && (error as { code?: string }).code === 'EADDRINUSE'
}
