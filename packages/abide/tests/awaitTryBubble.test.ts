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

/* A controllable deferred — the awaited thunk returns one of these, rejected on a LATER
   microtask so the block goes through pending → error while mounted. */
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

/* Mounts a compiled client body (mirrors reactiveTry.test.ts): the `$$`-prefixed runtime
   helpers resolve to the real modules via the uiPreload globals, so only the author-script
   bare names (`gate`) need injecting. */
function mount(source: string, injected: Record<string, unknown> = {}): { host: HTMLElement } {
    const host = document.createElement('div')
    const names = Object.keys(injected)
    const body = `${compileComponent(source)}\nreturn typeof $$model !== 'undefined' ? $$model : undefined;`
    new Function('host', ...names, body)(host, ...names.map((name) => injected[name]))
    return { host }
}

describe('catch-less {#await} bubbles its rejection to an enclosing {#try}', () => {
    test('a catch-less await inside {#try} routes a later rejection to the try catch branch', async () => {
        const d = deferred()
        const { host } = mount(
            `{#try}<div>{#await gate()}<p>loading</p>{:then v}<span>{v}</span>{/await}</div>{:catch err}<b>caught:{err}</b>{/try}`,
            { gate: () => d.promise },
        )
        /* Pending initially — the await shows its pending branch, the try is not triggered. */
        expect(serialize(host)).toContain('loading')
        expect(serialize(host)).not.toContain('<b>')

        d.reject(new Error('kaboom'))
        await settle()

        /* The catch-less await routed its rejection to the enclosing {#try} boundary — the try
           catch branch is shown with the error (proving it bubbled, not unhandled). */
        expect(serialize(host)).not.toContain('loading')
        expect(serialize(host)).toContain('<b>')
        expect(host.textContent).toContain('caught:')
        expect(host.textContent).toContain('kaboom')
    })

    test('a catch-less await NOT inside a {#try} is unchanged (no boundary to route to)', async () => {
        /* Behaviour unchanged when no boundary is ambient at build: with no {#try} the block has
           nowhere to route, so a rejection still surfaces as an unhandled rejection — which bun's
           test runner hard-fails on regardless of listeners (see uiAwaitUncaught.test.ts), so it
           can't be asserted here. Assert the intact no-boundary happy path instead: the block
           mounts and resolves normally, proving the boundary wiring didn't disturb it. */
        const d = deferred()
        const { host } = mount(
            `<div>{#await gate()}<p>loading</p>{:then v}<span>{v}</span>{/await}</div>`,
            { gate: () => d.promise },
        )
        expect(host.textContent).toContain('loading')
        d.resolve('ok')
        await settle()
        expect(host.textContent).toContain('ok')
    })

    test('an await WITH a local :catch inside {#try} handles it locally — the try is NOT triggered', async () => {
        const d = deferred()
        const { host } = mount(
            `{#try}<div>{#await gate()}<p>loading</p>{:then v}<span>{v}</span>{:catch e}<i>local:{e}</i>{/await}</div>{:catch err}<b>outer:{err}</b>{/try}`,
            { gate: () => d.promise },
        )
        d.reject(new Error('kaboom'))
        await settle()

        /* The local catch branch handled it; the enclosing {#try} stayed on its guarded branch. */
        expect(host.textContent).toContain('local:')
        expect(host.textContent).toContain('kaboom')
        expect(serialize(host)).not.toContain('<b>')
        expect(host.textContent).not.toContain('outer:')
    })
})

describe('catch-less {#for await} bubbles its rejection to an enclosing {#try}', () => {
    test('a catch-less for-await inside {#try} routes an iterator rejection to the try catch branch', async () => {
        /* An async iterable that rejects on its first pull (a later microtask). */
        const failingStream = async function* (): AsyncGenerator<{ id: string; text: string }> {
            throw new Error('streamboom')
        }
        const { host } = mount(
            `{#try}<ul>{#for await row of gate() by row.id}<li>{row.text}</li>{/for}</ul>{:catch err}<b>caught:{err}</b>{/try}`,
            { gate: () => failingStream() },
        )
        await settle()

        expect(serialize(host)).toContain('<b>')
        expect(host.textContent).toContain('caught:')
        expect(host.textContent).toContain('streamboom')
    })
})
