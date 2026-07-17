import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'

/*
ADR-0049 — a component mount is an ADDRESSED boundary (`abide:c:CHILDPATH`), so a structural
hydration desync INSIDE a child recovers at that one boundary (`discardAndRebuild`) instead of
throwing out of `hydrate` and letting the router discard the whole page.

The faithful repro is the `/media` RefreshIndicator bug: a child gates an element's PRESENCE on a
client-only "pending"-style probe — false on the server (which never sees the client-only in-flight
state), true on the client. The `{#if probe()}` renders no element in SSR and an element on hydrate,
a client-true / server-false STRUCTURAL divergence.
*/

let reset: () => void
beforeAll(() => {
    reset = installHappyDom()
})
afterAll(() => reset())
afterEach(() => {
    document.body.innerHTML = ''
    for (const id of Object.keys(RESUME)) {
        delete RESUME[id]
    }
})

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, mount }

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return Object.assign(fn, { build: fn })
}

async function settle(): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve()
    }
}

describe('component boundary recovery (ADR-0049)', () => {
    /* A client-only "pending"-style probe: false on the server, true on the client — the same
       client-true / server-false shape a `pending({ tags })` probe over a client-only fetch has. */
    let clientSide = false
    const probe = () => clientSide

    /* The gated element carries a BINDING (`class={cls}`), so it compiles to `skeleton()` with an
       element hole — the throwing path the RefreshIndicator bug hit — not the silent-claim
       `cloneStatic` a purely-static element would take. On a hydrate miss `resolveElementHole`
       throws, and `mountChild` recovers. */
    const Spinner = component(
        `
        <script>let show = probe(); let cls = 'text-stone-400'</script>
        {#if show}<span data-spin class={cls}>spin</span>{/if}
    `,
        { probe },
    )
    /* Static siblings around the child prove the page is NOT discarded — they survive as the same
       server nodes while only the child's boundary is remounted. */
    const Parent = component('<div><b>before</b><Spinner /><i>after</i></div>', { Spinner })

    test('a client-true / server-false {#if} recovers at the child boundary, not the page', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)

        /* SSR with the probe false: the child renders no spinner, bracketed in its addressed
           boundary `abide:c:0`. */
        clientSide = false
        const server = (await Parent.render()) as SsrRender
        expect(server.html).toContain('abide:c:0')
        expect(server.html).not.toContain('data-spin')
        host.innerHTML = server.html

        const beforeEl = host.querySelector('b')
        const afterEl = host.querySelector('i')
        expect(beforeEl).not.toBeNull()
        expect(afterEl).not.toBeNull()

        /* Hydrate with the probe true: the child's `{#if}` now expects a <span> the server DOM
           lacks — a structural desync. Pre-ADR-0049 this threw out of `hydrate`; now `mountChild`
           discards just the child boundary and remounts it fresh. */
        clientSide = true
        hydrate(host, (target) => Parent(target))
        await settle()

        /* The spinner appeared exactly once. */
        expect(host.querySelectorAll('[data-spin]').length).toBe(1)
        expect(host.textContent).toContain('spin')

        /* The parent's static siblings are the ORIGINAL server nodes — the desync cost one
           component, not the whole page. */
        expect(host.querySelector('b')).toBe(beforeEl)
        expect(host.querySelector('i')).toBe(afterEl)
    })

    /* Same divergence but the gated element is PURELY STATIC (no binding), so it compiles to
       `cloneStatic` — which claims a run without per-node checks. Without the static-run assertion
       this silently mis-claimed the diverged branch's close marker (no throw → no recovery → 0
       spinners AND a desynced cursor); with it, the miss throws and the boundary recovers. */
    const StaticSpinner = component(
        `
        <script>let show = probe()</script>
        {#if show}<span data-static-spin>spin</span>{/if}
    `,
        { probe },
    )
    const StaticParent = component('<div><b>before</b><StaticSpinner /><i>after</i></div>', {
        StaticSpinner,
    })

    test('a static (unbound) gated element also recovers — cloneStatic run is verified', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)

        clientSide = false
        const server = (await StaticParent.render()) as SsrRender
        expect(server.html).not.toContain('data-static-spin')
        host.innerHTML = server.html
        const beforeEl = host.querySelector('b')
        const afterEl = host.querySelector('i')

        clientSide = true
        hydrate(host, (target) => StaticParent(target))
        await settle()

        expect(host.querySelectorAll('[data-static-spin]').length).toBe(1)
        expect(host.querySelector('b')).toBe(beforeEl)
        expect(host.querySelector('i')).toBe(afterEl)
    })

    test('a congruent child (probe matches both sides) adopts in place with no remount', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)

        /* Probe true on BOTH sides — the spinner is present in SSR and expected on hydrate, so the
           addressed boundary adopts in place (the common no-desync path stays a clean adopt). */
        clientSide = true
        const server = (await Parent.render()) as SsrRender
        expect(server.html).toContain('data-spin')
        host.innerHTML = server.html
        const spanBefore = host.querySelector('[data-spin]')

        hydrate(host, (target) => Parent(target))
        await settle()

        /* Same node adopted, not rebuilt or duplicated. */
        expect(host.querySelectorAll('[data-spin]').length).toBe(1)
        expect(host.querySelector('[data-spin]')).toBe(spanBefore)
    })
})
