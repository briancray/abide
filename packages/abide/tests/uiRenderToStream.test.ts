import { describe, expect, test } from 'bun:test'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { safeJsonForScript } from '../src/lib/shared/safeJsonForScript.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'

/* The ref-json entry a streamed `<abide-resolve>` data block carries — matches
   encodeResume: ref-json with `<` neutralized for the raw script-content. */
function frameData(entry: unknown): string {
    return encodeRefJson(entry).replace(/</g, '\\u003c')
}

/* The inline `__abideSeeds.resume` seed-map literal for a single id — matches
   resumeSeedScript: the ref-json-encoded entry as the value, wrapped for inlining. */
function seedMap(id: number, entry: unknown): string {
    return safeJsonForScript({ [id]: encodeRefJson(entry) })
}

/* Builds a server render() from a component's compiled SSR body. */
function renderer(source: string): () => SsrRender {
    const body = compileSSR(source)
    return () =>
        new Function('doc', 'state', 'computed', 'effect', body)(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
}

async function collect(source: string): Promise<string[]> {
    const chunks: string[] = []
    for await (const chunk of renderToStream(renderer(source))) {
        chunks.push(chunk)
    }
    return chunks
}

describe('renderToStream — out-of-order SSR streaming', () => {
    test('flushes the pending shell first, then resolved fragments as they settle', async () => {
        const chunks = await collect(`
            <script>
                let slow = () => new Promise((resolve) => setTimeout(() => resolve('SLOW'), 25))
                let fast = () => Promise.resolve('FAST')
            </script>
            <div>
                {#await slow()}
                    <p>loading slow</p>
                    {:then v}<span>{v}</span>
                {/await}
                {#await fast()}
                    <p>loading fast</p>
                    {:then v}<b>{v}</b>
                {/await}
            </div>
        `)

        // 1) the shell: both pending branches, inside boundary markers
        expect(chunks[0]).toBe(
            '<div>' +
                '<!--a--><!--abide:await:0--><p>loading slow</p><!--/abide:await:0-->' +
                '<!--a--><!--abide:await:1--><p>loading fast</p><!--/abide:await:1-->' +
                '</div>',
        )
        // 2) resolved fragments out of order: fast (id 1) before slow (id 0), each
        //    carrying its serialized value for the resume manifest
        expect(chunks[1]).toBe(
            `<abide-resolve data-id="1"><script type="application/json">${frameData({ ok: true, value: 'FAST' })}</script><b>FAST</b></abide-resolve>`,
        )
        expect(chunks[2]).toBe(
            `<abide-resolve data-id="0"><script type="application/json">${frameData({ ok: true, value: 'SLOW' })}</script><span>SLOW</span></abide-resolve>`,
        )
        expect(chunks).toHaveLength(3)
    })

    test('a rejected await streams its catch branch', async () => {
        const chunks = await collect(`
            <script>let boom = () => Promise.reject('nope')</script>
            {#await boom()}
                <p>loading</p>
                {:then v}<span>{v}</span>
                {:catch e}<i>{e}</i>
            {/await}
        `)
        expect(chunks[0]).toContain('<!--abide:await:0--><p>loading</p><!--/abide:await:0-->')
        expect(chunks[1]).toBe(
            `<abide-resolve data-id="0"><script type="application/json">${frameData({ ok: false, error: 'nope' })}</script><i>nope</i></abide-resolve>`,
        )
    })

    test('a fully synchronous component streams just the shell', async () => {
        const chunks = await collect(`
            <script>import { state } from '@abide/abide/ui/state'
let name = state('ada')</script>
            <p>{name}</p>
        `)
        expect(chunks).toEqual(['<p>ada</p>'])
    })

    /* A `then` on the `await` tag → blocking: the resolved branch is spliced into its
       boundary in the first (and only) chunk, with the value seeded inline; no pending
       shell, no `<abide-resolve>` frame. */
    test('a blocking await (then on the tag) inlines its resolved branch in the first flush', async () => {
        const chunks = await collect(`
            <script>let load = () => Promise.resolve('VAL')</script>
            <div>
                {#await load() then v}<span>{v}</span>{/await}
            </div>
        `)
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toBe(
            '<div><!--a--><!--abide:await:0--><span>VAL</span><!--/abide:await:0--></div>' +
                '<script>Object.assign((window.__abideSeeds=window.__abideSeeds||{}).resume=window.__abideSeeds.resume||{},' +
                `${seedMap(0, { ok: true, value: 'VAL' })})</script>`,
        )
    })

    test('a blocking await splices values containing $-sequences literally (no regex replacement patterns)', async () => {
        const chunks = await collect(`
            <script>let load = () => Promise.resolve('price $9 $& $\` $0 off')</script>
            <div>
                {#await load() then v}<span>{v}</span>{/await}
            </div>
        `)
        expect(chunks).toHaveLength(1)
        /* `{v}` escapes the `&`, but `$&amp;`/`$\`` are still replacement patterns the
           buggy splice would expand — they must survive verbatim inside the boundary. */
        expect(chunks[0]).toContain('<span>price $9 $&amp; $` $0 off</span>')
    })

    test('a blocking await renders its catch branch on rejection, still pre-flush', async () => {
        const chunks = await collect(`
            <script>let boom = () => Promise.reject('nope')</script>
            {#await boom() then v}
                <span>{v}</span>
                {:catch e}<i>{e}</i>
            {/await}
        `)
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toContain('<!--abide:await:0--><i>nope</i><!--/abide:await:0-->')
        expect(chunks[0]).toContain(seedMap(0, { ok: false, error: 'nope' }))
    })

    /* Blocking + streaming side by side: the blocking value is in the first chunk, the
       streaming one flushes its pending shell there and resolves out of order after. */
    test('blocking and streaming awaits coexist', async () => {
        const chunks = await collect(`
            <script>
                let blockingLoad = () => Promise.resolve('NOW')
                let streamingLoad = () => Promise.resolve('LATER')
            </script>
            <div>
                {#await blockingLoad() then v}<b>{v}</b>{/await}
                {#await streamingLoad()}
                    <p>loading</p>
                    {:then v}<span>{v}</span>
                {/await}
            </div>
        `)
        expect(chunks[0]).toContain('<!--abide:await:0--><b>NOW</b><!--/abide:await:0-->')
        expect(chunks[0]).toContain('<!--abide:await:1--><p>loading</p><!--/abide:await:1-->')
        expect(chunks[0]).toContain(seedMap(0, { ok: true, value: 'NOW' }))
        expect(chunks[1]).toBe(
            `<abide-resolve data-id="1"><script type="application/json">${frameData({ ok: true, value: 'LATER' })}</script><span>LATER</span></abide-resolve>`,
        )
    })
})
