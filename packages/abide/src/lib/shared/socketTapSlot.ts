/*
Passive observation seam for published socket frames — the socket analogue of
logTapSlot. defineSocket's publish() calls the tap (when set) with every frame
it fans out, so an observer sees the same payloads subscribers receive. The
inspector installs one to fold socket traffic into its feed; unset everywhere
else, so the call no-ops. One slot, one in-process observer. Mirrors logTapSlot.
*/
export const socketTapSlot: {
    tap: ((frame: { socket: string; message: unknown }) => void) | undefined
} = {
    tap: undefined,
}
