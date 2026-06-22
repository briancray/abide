import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { anchorCursor } from '../src/lib/ui/dom/anchorCursor.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { cloneStatic } from '../src/lib/ui/dom/cloneStatic.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import { skeleton } from '../src/lib/ui/dom/skeleton.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => installMiniDom())

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    attr,
    skeleton,
    when,
    mountChild,
    anchorCursor,
    cloneStatic,
}

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((n) => runtime[n as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return Object.assign(fn, { build: fn })
}

const Loading = component(`<i class="spin">o</i>`)
const HardDrive = component(`<i class="hd">x</i>`)

const serialize = (host: unknown) =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

describe('bare component as control-flow branch root hydrates (no flip)', () => {
    test('skeleton context: <if> inside an element', async () => {
        const parent = component(
            `
            <script>let busy = scope().state(false)</script>
            <div><template if={busy}><Loading/><template else><HardDrive/></template></template></div>`,
            { Loading, HardDrive },
        )
        const server = (await parent.render()) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html
        hydrate(host, (t: Element) => parent(t))
        expect(serialize(host)).toBe(server.html)
    })

    test('non-skeleton context: <if> at component top level', async () => {
        const parent = component(
            `
            <script>let busy = scope().state(false)</script>
            <template if={busy}><Loading/><template else><HardDrive/></template></template>`,
            { Loading, HardDrive },
        )
        const server = (await parent.render()) as SsrRender
        const host = document.createElement('div')
        host.innerHTML = server.html
        hydrate(host, (t: Element) => parent(t))
        expect(serialize(host)).toBe(server.html)
    })
})

describe('hydration desync surfaces as a named error, not a downstream null-deref', () => {
    test('a missing range marker throws an [abide] hydration desync, not a TypeError', () => {
        const parent = component(
            `
            <script>let busy = scope().state(false)</script>
            <div><template if={busy}><Loading/><template else><HardDrive/></template></template></div>`,
            { Loading, HardDrive },
        )
        const host = document.createElement('div')
        // server DOM with the if-block's range markers ABSENT (only the anchor) — a structural
        // SSR/client disagreement: the build expects to claim a `[` marker at the anchor.
        host.innerHTML = '<div><!--a--></div>'
        expect(() => hydrate(host, (t: Element) => parent(t))).toThrow(/hydration desync/)
    })
})
