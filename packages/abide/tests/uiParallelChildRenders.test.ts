import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
ADR-0037 Phase 2 + ADR-0039 — sibling `<Card/>` renders START in the SSR prefix (as isolated
flights), overlapping instead of serializing. A card still PENDING when the walk finishes STREAMS
(ADR-0039): the shell flushes with an empty `abide:await:CHILDPATH` boundary, and the card's fragment
streams when it settles. Three cards each blocking on a ~40ms read stream in ~max (one delay), not
~sum (three) — proving the flights overlap. (A fast/settled child would instead inline byte-identical
to the pre-ADR-0039 path — covered by uiComponentStreamSpike / the compile golden tests.)
*/

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = { state, computed, effect, appendText, appendStatic, awaitBlock, mount }

function component(source: string, extra: Record<string, unknown> = {}) {
    const ssrBody = compileSSR(source)
    /* Compile the client body too, so a real cross-compile can't silently diverge. */
    compileComponent(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = () => undefined
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return fn
}

const DELAY = 40

describe('parallel sibling child renders (ADR-0037 Phase 2)', () => {
    /* A childless card blocking on a ~40ms read — childless + no props ⇒ hoistable. */
    const Card = component(`
        <script>let load = () => new Promise((r) => setTimeout(() => r('C'), ${DELAY}))</script>
        {#await load() then v}<span>card:{v}</span>{/await}
    `)
    const Parent = component(`<div><Card /><Card /><Card /></div>`, { Card })

    test('three sibling cards stream in ~max, not ~sum, of their latencies', async () => {
        const start = performance.now()
        const chunks: string[] = []
        for await (const chunk of renderToStream(() => Parent.render())) {
            chunks.push(chunk)
        }
        const elapsed = performance.now() - start
        const all = chunks.join('')

        /* Shell flushed FIRST with three empty card boundaries (paths 0/1/2), no child html yet —
           the slow cards stream rather than block the shell. */
        for (const id of ['0', '1', '2']) {
            expect(chunks[0]).toContain(`<!--abide:await:${id}-->`)
        }
        expect(chunks[0]).not.toContain('card:C')
        /* All three cards streamed their resolved fragment, each keyed by its own child path. */
        expect(all.match(/card:C/g) ?? []).toHaveLength(3)
        for (const id of ['0', '1', '2']) {
            expect(all).toContain(`data-id="${id}"`)
        }
        /* Overlapped: the three ~40ms cards settled concurrently — nowhere near 3×DELAY. */
        expect(elapsed).toBeLessThan(DELAY * 2.4)
    })
})
