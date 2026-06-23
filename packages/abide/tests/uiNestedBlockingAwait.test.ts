import { describe, expect, test } from 'bun:test'
import { decodeRefJson } from '../src/lib/shared/decodeRefJson.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { ResumeEntry } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'

/*
Regression target for the nested-blocking-await SSR bug. A blocking await (`then` on
the tag) settles BEFORE the first flush, but today its `then` content is rendered in
`renderToStream`'s settle phase — at render depth 0, AFTER the synchronous render pass
exited. That asymmetry breaks three ways when a blocking await's resolved branch itself
contains a blocking await (the idiomatic nested page-load: `sources → filteredSources`):

  A — counter reset. A `then` that renders a child component re-enters `enterRenderPass`
      at depth 0 mid-settle, resetting `RENDER.blockId` to 0, so ids allocated during
      settle collide with sync-pass ids (RESUME is id-keyed → hydration desync).
  B — wrong order. A nested await draws its id during settle, AFTER every sync-level
      sibling — but the client allocates depth-first, so the manifest misaligns.
  C — never rendered. A nested blocking await is `$awaits.push`-ed during settle, after
      `renderToStream` already snapshotted the blocking batch and past the streaming
      loop (which skips blocking entries) — so it renders empty with no resume value.

These tests assert the POST-FIX contract (inline depth-first blocking render) and fail
on the current deferred-settle engine.
*/

/* Builds an SSR-only render() from a component's compiled body. Child components pass
   through `extra` (their SSR `render` is invoked when the parent inlines them). */
const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock, mount }
function component(source: string, extra: Record<string, unknown> = {}) {
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, compileComponent(source))(host, props, ...values)
    /* `$ctx` (request-local block-id counter) threaded so a child shares the page's
       depth-first numbering; the page render passes it when inlining the child. */
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return fn
}

async function streamToString(render: () => SsrRender | Promise<SsrRender>): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

/* The blocking-resume manifest the inline `__abideResume` seed script carries, keyed by
   boundary id. Parsed from the streamed HTML so a test can assert id → value alignment.
   Each seeded entry is a ref-json string, decoded back to its ResumeEntry. */
function resumeManifest(html: string): Record<string, ResumeEntry> {
    const match = html.match(/window\.__abideResume\|\|\{\},(\{.*?\})\)<\/script>/)
    if (!match) {
        return {}
    }
    const encoded = JSON.parse(match[1]) as Record<string, string>
    return Object.fromEntries(
        Object.entries(encoded).map(([id, entry]) => [id, decodeRefJson(entry) as ResumeEntry]),
    )
}

describe('nested blocking awaits render inline, depth-first, on SSR', () => {
    /* C + B: an outer blocking await whose resolved branch holds a second blocking await,
       then a sibling blocking await. Depth-first ids: outer=0, inner=1, sibling=2 — and
       every value present in the first flush. Today the inner never renders and the
       sibling steals id 1. */
    test('a nested blocking await renders its value with a depth-first id', async () => {
        const render = component(`
            <script>
                let outer = () => Promise.resolve('OUT')
                let inner = () => Promise.resolve('IN')
                let sib = () => Promise.resolve('SIB')
            </script>
            <div>
                <template await={outer()} then="o">
                    <b>{o}</b>
                    <template await={inner()} then="i"><span>{i}</span></template>
                </template>
                <template await={sib()} then="s"><em>{s}</em></template>
            </div>
        `).render
        const html = await streamToString(render)

        // C: the nested blocking branch is in the first paint, not an empty boundary.
        expect(html).toContain('<span>IN</span>')
        // B: depth-first ids — inner is 1 (right after its parent 0), sibling is 2.
        expect(resumeManifest(html)).toEqual({
            0: { ok: true, value: 'OUT' },
            1: { ok: true, value: 'IN' },
            2: { ok: true, value: 'SIB' },
        })
        // A blocking page has no out-of-order frames — everything is pre-flush.
        expect(html).not.toContain('<abide-resolve')
    })

    /* A + C: the realistic page shape. Two sibling blocking awaits each resolve to a child
       component that has its OWN blocking await. Inlining the children during settle today
       re-enters `enterRenderPass` at depth 0, resetting the counter so the grandchild ids
       collide; and those grandchild awaits, pushed mid-settle, never render. */
    test('sibling blocking awaits whose then renders a child-with-await keep unique ids', async () => {
        const Card = component(`
            <script>let load = () => Promise.resolve('CARD')</script>
            <template await={load()} then="v"><span>card:{v}</span></template>
        `)
        const render = component(
            `
            <script>
                let a = () => Promise.resolve('A')
                let b = () => Promise.resolve('B')
            </script>
            <div>
                <template await={a()} then="x"><h1>{x}</h1><Card /></template>
                <template await={b()} then="y"><h2>{y}</h2><Card /></template>
            </div>
        `,
            { Card },
        ).render
        const html = await streamToString(render)

        // C: both cards' inner awaits resolved server-side.
        expect(html.match(/card:CARD/g) ?? []).toHaveLength(2)
        // A: four await boundaries (2 page + 2 card), all with distinct ids 0..3.
        const ids = [...html.matchAll(/<!--abide:await:(\d+)-->/g)].map((m) => Number(m[1]))
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBe(4)
        // every boundary has a resume value (none orphaned by a mid-settle push).
        const manifest = resumeManifest(html)
        for (const id of ids) {
            expect(manifest[id]).toBeDefined()
        }
    })

    /* Blocking awaits render inline depth-first, which means SERIAL by design: matching
       the client's one-pass adopt requires allocating each block's id (and any nested
       id) in document order, so a sibling can't render until the prior subtree resolves.
       This is correct and free for the idiomatic dependent chain (`sources →
       filteredSources`); for INDEPENDENT concurrent reads, await one `Promise.all([...])`
       or use streaming awaits (no `then`), which flush out of order. This test pins the
       serial-but-correct contract: both values present, in source order. */
    test('sibling blocking awaits render in source order (serial by design)', async () => {
        const render = component(`
            <script>
                let one = () => Promise.resolve('ONE')
                let two = () => Promise.resolve('TWO')
            </script>
            <div>
                <template await={one()} then="a"><b>{a}</b></template>
                <template await={two()} then="b"><i>{b}</i></template>
            </div>
        `).render
        const html = await streamToString(render)
        expect(html).toContain('<div><!--a--><!--abide:await:0--><b>ONE</b>')
        expect(html.indexOf('<b>ONE</b>')).toBeLessThan(html.indexOf('<i>TWO</i>'))
        expect(resumeManifest(html)).toEqual({
            0: { ok: true, value: 'ONE' },
            1: { ok: true, value: 'TWO' },
        })
    })
})
