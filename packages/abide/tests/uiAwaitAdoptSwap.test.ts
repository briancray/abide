import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/*
The await block's HYDRATE-ADOPT → first-SWAP path, the gap the streaming/SSR suites leave:
they cover client-fresh rendering (`uiAwaitBlock`) and the streaming swap of a fresh shell
(`uiStreamSwap`), but not a warm-sync adopt of a server-rendered then-branch followed by a
reactive re-run that swaps the branch. That FIRST swap is the risky seam — it must evict the
exact region the adopt claimed (markers, anchor, and all roots), which is where a multi-root
branch most exposes a node-tracking bug.

The asserted invariants are deliberately markup-agnostic (visible text, node survival, full
eviction), so they hold whether the adopted region is tracked as a node array or bracketed as
a marker range — the corpus pins behaviour the representation must preserve, not the
representation.
*/
const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    attr,
    text,
    each,
    when,
    awaitBlock,
    mount,
}

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
    return fn
}

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

/* Drive the streaming-await hydrate the way production does: parse the pending shell, then
   `applyResolved` each streamed `<abide-resolve>` fragment (swapping pending→resolved in the
   DOM and seeding `RESUME[id]`, exactly as the inline swap script does before the bundle
   boots), then `hydrate` — so the block adopts the resolved branch via its resume path. A
   desync throw fails the test loudly (the await boundary markers must line up). */
async function hydrateStreamed(
    render: () => SsrRender | Promise<SsrRender>,
    build: (host: Element) => void,
): Promise<HTMLElement> {
    const host = document.createElement('div')
    let first = true
    for await (const chunk of renderToStream(render)) {
        if (first) {
            host.innerHTML = chunk
            first = false
        } else {
            applyResolved(host, chunk)
        }
    }
    hydrate(host, (target) => build(target))
    return host
}

/* Settled microtasks — a swap that routes through a rejected/resolved promise lands after two
   turns (the await effect's `.then`, then the settle's own work). */
async function settle(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

type DomLike = { childNodes: ArrayLike<unknown>; tagName?: string; textContent?: string | null }
function find(node: DomLike, tag: string): DomLike | undefined {
    for (let index = 0; index < node.childNodes.length; index += 1) {
        const child = node.childNodes[index] as DomLike
        if (child.tagName === tag.toUpperCase() || child.tagName === tag) {
            return child
        }
        const nested = find(child, tag)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}

describe('await block: hydrate-adopt then first swap', () => {
    /* A single-root then-branch: adopt the server `<span>A</span>`, then a re-run that rejects
       must swap to the catch branch — evicting the adopted then-range entirely. */
    test('single-root: adopt, then→catch evicts the adopted then-range', async () => {
        const n = state(0)
        const make = (value: number) => (value === 0 ? 'A' : Promise.reject('boom'))
        const Comp = component(
            `
            <script></script>
            {#await make(n.value)}
                <p>pending</p>
                {:then value}<span>{value}</span>
                {:catch err}<b>{err}</b>
            {/await}
        `,
            { make, n },
        )
        const host = await hydrateStreamed(() => Comp.render(), Comp)
        expect(host.textContent).toBe('A') // adopted the streamed then-branch — no pending flash

        n.value = 1 // re-run → rejects → swap to catch
        await settle()
        expect(host.textContent).toBe('boom') // catch shown
        expect(find(host, 'span')).toBeUndefined() // the adopted then-root is gone, not orphaned
    })

    /* A MULTI-ROOT then-branch — the case a node-array vs marker-range eviction most differs on.
       Both `<b>` and `<span>` must leave when the branch swaps. */
    test('multi-root: adopt, then→catch removes EVERY adopted root', async () => {
        const n = state(0)
        const make = (value: number) => (value === 0 ? 'A' : Promise.reject('boom'))
        const Comp = component(
            `
            <script></script>
            {#await make(n.value)}
                <p>pending</p>
                {:then value}<b>tag</b><span>{value}</span>
                {:catch err}<i>{err}</i>
            {/await}
        `,
            { make, n },
        )
        const host = await hydrateStreamed(() => Comp.render(), Comp)
        expect(host.textContent).toBe('tagA')

        n.value = 1
        await settle()
        expect(host.textContent).toBe('boom')
        expect(find(host, 'b')).toBeUndefined() // first adopted root evicted
        expect(find(host, 'span')).toBeUndefined() // second adopted root evicted
    })

    /* A then-branch whose content is itself a nested control-flow block — adoption claims the
       block's range; the swap must evict it whole. */
    test('nested-block then: adopt, then→catch evicts the nested range', async () => {
        const n = state(0)
        const make = (value: number) => (value === 0 ? 'A' : Promise.reject('boom'))
        const Comp = component(
            `
            <script>import { state } from '@abide/abide/ui/state'
let on = state(true)</script>
            {#await make(n.value)}
                <p>pending</p>
                {:then value}{#if on}<span>{value}</span>{/if}
                {:catch err}<b>{err}</b>
            {/await}
        `,
            { make, n },
        )
        const host = await hydrateStreamed(() => Comp.render(), Comp)
        expect(host.textContent).toBe('A')

        n.value = 1
        await settle()
        expect(host.textContent).toBe('boom')
        expect(find(host, 'span')).toBeUndefined()
    })

    /* then→then after adopt: a re-run resolving to a new value of the SAME kind must update the
       adopted branch in place (the no-flash cache-revalidate contract) — the `<i>` marker keeps
       identity, proving the adopt produced a working value cell rather than a throwaway range. */
    test('then→then: adopt, re-resolve updates in place (no rebuild)', async () => {
        const n = state(0)
        const make = (value: number) => `v${value}` // warm-sync both runs
        const Comp = component(
            `
            <script></script>
            {#await make(n.value)}
                {:then value}<i></i><span>{value}</span>
            {/await}
        `,
            { make, n },
        )
        const host = await hydrateStreamed(() => Comp.render(), Comp)
        expect(find(host, 'span')?.textContent).toBe('v0')
        const marker = find(host, 'i')

        n.value = 1
        await settle()
        expect(find(host, 'span')?.textContent).toBe('v1') // value updated reactively
        expect(find(host, 'i')).toBe(marker) // same node → updated in place, not rebuilt
    })
})
