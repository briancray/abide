// SYNCHRONOUS SETTLED-VALUE HINT in the TEXT paths (`interpolate` + `awaitText`).
//
// `shared/internal/settledRead.ts` tags an already-resolved coalesced load with its synchronous value.
// `claimAwait` has consumed that hint since the Promise-read model landed; the two text paths did not,
// so they blanked the node and refilled on the microtask for a WARM read too. That refill is never
// visible (microtasks drain before the rendering steps) — the win is a DOM that is correct
// SYNCHRONOUSLY after mount, and a primed pass that corrects/converges instead of stranding.
//
// Covers both modes for both functions:
//   CREATE  (soft nav / reactive re-run) — hint → write synchronously; no hint → blank, fill on settle.
//   PRIMED  (hydrate pass 1)             — hint → correct a diverged claim; no hint → keep the server
//                                          text AND register the fill so resolution converges.

import { describe, expect, test } from 'bun:test'
import { markSettled } from '../../shared/internal/settledRead.ts'
import { loadEmitted } from './emit.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

function must<T>(value: T | null | undefined, message = 'expected a non-null value'): T {
    if (value === null || value === undefined) throw new Error(message)
    return value
}

// A warm read: resolved promise carrying the synchronous hint, exactly as `memo`/`makeRpc` produce it.
function warm<T>(value: T): () => Promise<T> {
    const promise = markSettled(Promise.resolve(value), value)
    return () => promise
}

// A genuinely-pending read: no hint, resolves on the microtask.
function cold<T>(value: T): () => Promise<T> {
    const promise = Promise.resolve(value)
    return () => promise
}

const TEXT = 3

describe('interpolate — settled hint', () => {
    test('CREATE: a warm read writes synchronously — DOM correct without awaiting', async () => {
        const emitted = await loadEmitted('<span>{fn()}</span>')
        const host = document.createElement('div')

        const dispose = emitted.mount(host, { fn: warm('Bob') })

        // The load-bearing assertion: NO await between mount and read. Before the hint was consumed the
        // node was created empty here and only filled a microtask later.
        const span = must(host.querySelector('span'))
        const node = must(span.firstChild) as Text
        expect(node.nodeType).toBe(TEXT)
        expect(node.data).toBe('Bob')

        dispose()
    })

    test('CREATE: a cold read still blanks, then fills on settle', async () => {
        const emitted = await loadEmitted('<span>{fn()}</span>')
        const host = document.createElement('div')

        const dispose = emitted.mount(host, { fn: cold('Bob') })

        const span = must(host.querySelector('span'))
        const node = must(span.firstChild) as Text
        expect(node.data).toBe('') // no hint → genuinely pending
        await tick()
        expect(node.data).toBe('Bob') // same node, filled in place
        expect(must(must(host.querySelector('span')).firstChild)).toBe(node)

        dispose()
    })

    test('PRIMED: a warm read whose value DIVERGED from the server corrects the claim in place', async () => {
        const emitted = await loadEmitted('<span>{fn()}</span>')
        const host = document.createElement('div')
        // Server blocked on the read and painted "server".
        host.innerHTML = await emitted.render({ fn: warm('server') })
        const serverNode = must(must(host.querySelector('span')).firstChild) as Text
        expect(serverNode.data).toBe('server')

        // Client's warm slot says "client" — a real divergence, knowable synchronously via the hint.
        const dispose = emitted.hydrate(host, { fn: warm('client') })

        // SAME node object (no recreate), corrected in place.
        expect(must(must(host.querySelector('span')).firstChild)).toBe(serverNode)
        expect(serverNode.data).toBe('client')

        dispose()
    })

    test('PRIMED: an agreeing warm read leaves the claimed node untouched', async () => {
        const emitted = await loadEmitted('<span>{fn()}</span>')
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({ fn: warm('same') })
        const serverNode = must(must(host.querySelector('span')).firstChild) as Text

        const dispose = emitted.hydrate(host, { fn: warm('same') })

        expect(must(must(host.querySelector('span')).firstChild)).toBe(serverNode)
        expect(serverNode.data).toBe('same')

        dispose()
    })

    test('PRIMED: a cold read keeps the server text, then CONVERGES when it resolves', async () => {
        const emitted = await loadEmitted('<span>{fn()}</span>')
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({ fn: warm('server') })
        const serverNode = must(must(host.querySelector('span')).firstChild) as Text

        const dispose = emitted.hydrate(host, { fn: cold('client') })

        // Pass 1 trusts the server output (decision 9) — nothing to correct synchronously.
        expect(serverNode.data).toBe('server')
        // The registered fill converges the SAME node once the read settles. Previously this branch
        // returned early with no `.then`, stranding the server text until a signal re-run.
        await tick()
        expect(serverNode.data).toBe('client')
        expect(must(must(host.querySelector('span')).firstChild)).toBe(serverNode)

        dispose()
    })
})

describe('awaitText — settled hint', () => {
    test('CREATE: a warm read writes synchronously', async () => {
        const emitted = await loadEmitted('<span>{await fn()}</span>')
        const host = document.createElement('div')

        const dispose = emitted.mount(host, { fn: warm('Bob') })

        const node = must(must(host.querySelector('span')).firstChild) as Text
        expect(node.nodeType).toBe(TEXT)
        expect(node.data).toBe('Bob')

        dispose()
    })

    test('CREATE: a cold read still blanks, then fills on settle', async () => {
        const emitted = await loadEmitted('<span>{await fn()}</span>')
        const host = document.createElement('div')

        const dispose = emitted.mount(host, { fn: cold('Bob') })

        const node = must(must(host.querySelector('span')).firstChild) as Text
        expect(node.data).toBe('')
        await tick()
        expect(node.data).toBe('Bob')

        dispose()
    })

    test('PRIMED: a warm read whose value DIVERGED from the server corrects the claim in place', async () => {
        const emitted = await loadEmitted('<span>{await fn()}</span>')
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({ fn: warm('server') })
        const serverNode = must(must(host.querySelector('span')).firstChild) as Text
        expect(serverNode.data).toBe('server')

        const dispose = emitted.hydrate(host, { fn: warm('client') })

        expect(must(must(host.querySelector('span')).firstChild)).toBe(serverNode)
        expect(serverNode.data).toBe('client')

        dispose()
    })
})
