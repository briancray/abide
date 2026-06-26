type Gate = { opened: Promise<void>; release: () => void }

function createGate(): Gate {
    let release: () => void = () => {}
    const opened = new Promise<void>((resolve) => {
        release = resolve
    })
    return { opened, release }
}

/*
Deferred the slow fixture rpc blocks on, so the streaming test controls
exactly when the pending {#await} read settles — no sleeps, no races.
`calls` counts handler runs so a test can assert the stashed SSR promise is
drained by the resolve stream rather than re-fetched.
*/
export const slowGate: { current: Gate; calls: number; reset: () => void } = {
    current: createGate(),
    calls: 0,
    reset: () => {
        slowGate.current = createGate()
        slowGate.calls = 0
    },
}
