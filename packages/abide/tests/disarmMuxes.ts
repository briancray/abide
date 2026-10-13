import { MUXES } from '#ui/socketWire.ts'

/**
 * Takes note of the muxes standing now, and answers the teardown that disarms every one opened
 * since: nothing subscribed and no socket, so a later file's sign-in (18.25) or a retry reaches
 * nothing.
 *
 * THE MUXES OUTLIVE THE FILE that opened them, being process-wide, and a sign-in in a later file
 * reopens every one — over a stub this file had put in place of `WebSocket` and since taken back, so
 * the reopen dialed a server that had stopped, through happy-dom's real socket, and its unhandled
 * error failed whatever test was running.
 */
export function disarmMuxes(): () => void {
    const standing = new Set(MUXES.keys())
    return () => {
        for (const [address, mux] of [...MUXES])
            if (!standing.has(address)) {
                mux.subscriptions.clear()
                mux.socket = null
                MUXES.delete(address)
            }
    }
}
