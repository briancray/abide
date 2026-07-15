import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'
import { streamSwap } from './support/streamSwap.ts'

/*
ADR-0039 — a STREAMED child component's HYDRATE-ADOPT (the cross-half proof). A slow hoistable
`<Child/>` streams (empty `abide:await:CHILDPATH` boundary in the shell; the child's `[ … ]` range
swapped in by `__abideSwap`), and on hydrate the dual-mode `mountChild` adopts it: no desync
crash, the child's value present exactly once (no double-mount).
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

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock, mount }

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
    await new Promise((resolve) => setTimeout(resolve, 30))
}

describe('streamed child component: hydrate-adopt', () => {
    /* A childless card blocking ~15ms — pending past finalize's macrotask ⇒ it STREAMS. */
    const Card = component(`
        <script>let load = () => new Promise((r) => setTimeout(() => r('C'), 15))</script>
        {#await load() then v}<span>card:{v}</span>{/await}
    `)
    const Parent = component('<div><Card /></div>', { Card })

    test('a streamed child hydrates without desync and shows its value once', async () => {
        const host = document.createElement('div')
        document.body.appendChild(host)

        let first = true
        for await (const chunk of renderToStream(() => Parent.render())) {
            if (first) {
                host.innerHTML = chunk
                first = false
                continue
            }
            /* Execute each streamed resume-delta `<script>` (the browser runs streamed scripts as
               parsed; insertAdjacentHTML does not), window-bound to globalThis like streamSwap. */
            for (const match of chunk.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
                new Function('window', match[1] as string)(globalThis)
            }
            streamSwap(chunk)
        }

        /* The shell carried the empty child boundary; the fragment swapped in the card's range. */
        expect(host.innerHTML).toContain('abide:await:0')
        expect(host.textContent).toContain('card:C')

        /* Hydrate — a marker/id desync would THROW here. */
        hydrate(host, (target) => Parent(target))
        await settle()

        /* Present exactly once (no double-mount) with its resolved value. */
        expect(host.textContent).toBe('card:C')
        expect((host.textContent?.match(/card:C/g) ?? []).length).toBe(1)
    })
})
