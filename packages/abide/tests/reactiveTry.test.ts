import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { createDoc } from '../src/lib/ui/runtime/createDoc.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

beforeAll(() => {
    installMiniDom()
})

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

/* A controllable deferred — the seed awaits one of these, and the test settles or rejects it
   on a LATER microtask to drive the async cell through pending → value / error. */
type Deferred = {
    promise: Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
}
function deferred(): Deferred {
    let resolve!: (value: unknown) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

/* Mounts a compiled client body. The abide-ui runtime helpers (`$$tryBlock`, `$$readCell`,
   `$$appendText`, …) resolve to the real modules via the `uiPreload` globals, so only the
   author-script bare names (`gate`, `boom`) need injecting. Returns the host and the
   component's `$$model` doc (for driving reactive slots). */
function mount(
    source: string,
    injected: Record<string, unknown> = {},
): { host: HTMLElement; model: ReturnType<typeof createDoc> } {
    const host = document.createElement('div')
    const names = Object.keys(injected)
    const body = `${compileComponent(source)}\nreturn typeof $$model !== 'undefined' ? $$model : undefined;`
    const model = new Function('host', ...names, body)(
        host,
        ...names.map((name) => injected[name]),
    ) as ReturnType<typeof createDoc>
    return { host, model }
}

/* An async computed whose seed awaits the injected `gate()` — reads `attempt` BEFORE the
   await so a dependency change reseeds (tracked). Read inside `{#try}`, so a rejection with
   no retained value throws `AsyncCellError` at the read site → the reactive boundary. */
const ASYNC = `
<script>
    import { state } from '@abide/abide/ui/state'
    let attempt = state(0)
    const v = state.computed(async () => { const a = attempt; return await gate(a) })
</script>
{#try}<p>{v}</p>{:catch err}<b>caught:{err}</b>{/try}
`

describe('reactive {#try} — later-run throw (ADR-0019 D3)', () => {
    test('an async cell that rejects on a later microtask swaps to the catch branch', async () => {
        const d = deferred()
        const { host } = mount(ASYNC, { gate: () => d.promise })
        /* Pending initially — the guarded branch is shown (v peeks undefined), not catch. */
        expect(serialize(host)).toContain('<p>')
        expect(serialize(host)).not.toContain('<b>')

        d.reject(new Error('kaboom'))
        await settle()

        /* The rejection surfaced as a LATER re-run throw (the old render-once boundary could
           not catch this) → catch branch, guarded gone. */
        expect(serialize(host)).not.toContain('<p>')
        expect(serialize(host)).toContain('<b>')
        expect(host.textContent).toContain('caught:')
        expect(host.textContent).toContain('kaboom')
    })

    test('refresh/reseed recovery heals the boundary back to the guarded branch', async () => {
        const gates: Deferred[] = []
        const { host, model } = mount(ASYNC, {
            gate: () => {
                const d = deferred()
                gates.push(d)
                return d.promise
            },
        })
        /* First flight rejects → catch. */
        gates[0]?.reject(new Error('boom'))
        await settle()
        expect(serialize(host)).toContain('<b>')
        expect(serialize(host)).not.toContain('<p>')

        /* Reseed by changing the tracked dependency → a fresh flight, which resolves. The
           keep-the-watch subscription hears error→value and rebuilds the guarded branch. */
        model.replace('attempt', 1)
        gates[1]?.resolve('recovered')
        await settle()

        expect(serialize(host)).toContain('<p>')
        expect(serialize(host)).not.toContain('<b>')
        expect(host.textContent).toContain('recovered')
    })
})

describe('reactive {#try} — regressions (same-state + initial throw)', () => {
    test('success → success updates the guarded branch in place (no swap)', () => {
        const SUCCESS = `
<script>
    import { state } from '@abide/abide/ui/state'
    let a = state(1)
    let b = state(2)
    const total = state.computed(a + b)
</script>
{#try}<p>{total}</p>{:catch err}<b>caught:{err}</b>{/try}
`
        const { host, model } = mount(SUCCESS)
        expect(host.textContent).toContain('3')
        model.replace('a', 10)
        /* Guarded value updated, never swapped to catch. */
        expect(serialize(host)).not.toContain('<b>')
        expect(host.textContent).toContain('12')
    })

    test('an initial synchronous throw swaps to the catch branch', () => {
        const THROW = `{#try}<p>{boom()}</p>{:catch err}<b>caught:{err}</b>{/try}`
        const { host } = mount(THROW, {
            boom: () => {
                throw 'splat'
            },
        })
        expect(serialize(host)).not.toContain('<p>')
        expect(host.textContent).toContain('caught:splat')
    })
})
