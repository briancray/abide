import { afterEach, beforeEach } from 'bun:test'

/*
Installs a `globalThis.window` for the surrounding describe so abide's consumers
take their browser branch (tail()/cache() reactivity, gated on
`typeof window`), and removes it afterward so the rest of the suite keeps seeing
the server branch. Call once inside a describe that drives reactivity.
*/
export function useBrowserWindow(): void {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = {}
    })
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window
    })
}
