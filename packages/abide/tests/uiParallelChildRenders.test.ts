import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
ADR-0037 Phase 2 — sibling `<Card/>` renders START in the SSR prefix (as isolated flights) and are
awaited at their positions, so their independent async work OVERLAPS instead of serializing behind
each other's `await Card.render(...)`. Three cards each blocking on a ~40ms read render in ~max
(one delay), not ~sum (three) — and each card's async cell drains in its own isolated barrier, so no
sibling reads a still-pending value.
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

    test('three sibling cards render in ~max, not ~sum, of their latencies', async () => {
        const start = performance.now()
        const { html, resume } = await Parent.render()
        const elapsed = performance.now() - start

        /* All three cards resolved server-side and inlined. */
        expect(html.match(/card:C/g) ?? []).toHaveLength(3)
        /* Overlapped: nowhere near 3×DELAY. Generous ceiling to stay non-flaky under load. */
        expect(elapsed).toBeLessThan(DELAY * 2.4)

        /* Each card's blocking value seeded under its OWN child-ordinal path (ADR-0037) — three
           distinct, non-colliding resume keys, so hydration adopts each card's own value. */
        expect(Object.keys(resume).sort()).toEqual(['0:0', '1:0', '2:0'])
        for (const key of ['0:0', '1:0', '2:0']) {
            expect(resume[key]).toEqual({ ok: true, value: 'C' })
        }
    })
})
