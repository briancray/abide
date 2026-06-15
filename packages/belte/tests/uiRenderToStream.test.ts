import { describe, expect, test } from 'bun:test'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'

/* Builds a server render() from a component's compiled SSR body. */
function renderer(source: string): () => SsrRender {
    const body = compileSSR(source)
    return () =>
        new Function('doc', 'state', 'derived', 'effect', body)(
            doc,
            state,
            derived,
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
                <template await={slow()}>
                    <p>loading slow</p>
                    <template then="v"><span>{v}</span></template>
                </template>
                <template await={fast()}>
                    <p>loading fast</p>
                    <template then="v"><b>{v}</b></template>
                </template>
            </div>
        `)

        // 1) the shell: both pending branches, inside boundary markers
        expect(chunks[0]).toBe(
            '<div>' +
                '<!--belte:await:0--><p>loading slow</p><!--/belte:await:0-->' +
                '<!--belte:await:1--><p>loading fast</p><!--/belte:await:1-->' +
                '</div>',
        )
        // 2) resolved fragments out of order: fast (id 1) before slow (id 0)
        expect(chunks[1]).toBe('<template data-belte-resolve="1"><b>FAST</b></template>')
        expect(chunks[2]).toBe('<template data-belte-resolve="0"><span>SLOW</span></template>')
        expect(chunks).toHaveLength(3)
    })

    test('a rejected await streams its catch branch', async () => {
        const chunks = await collect(`
            <script>let boom = () => Promise.reject('nope')</script>
            <template await={boom()}>
                <p>loading</p>
                <template then="v"><span>{v}</span></template>
                <template catch="e"><i>{e}</i></template>
            </template>
        `)
        expect(chunks[0]).toContain('<!--belte:await:0--><p>loading</p><!--/belte:await:0-->')
        expect(chunks[1]).toBe('<template data-belte-resolve="0"><i>nope</i></template>')
    })

    test('a fully synchronous component streams just the shell', async () => {
        const chunks = await collect(`
            <script>let name = state('ada')</script>
            <p>{name}</p>
        `)
        expect(chunks).toEqual(['<p>ada</p>'])
    })
})
