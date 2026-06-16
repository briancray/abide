import { beforeAll, describe, expect, test } from 'bun:test'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/*
The streaming loop end to end: server streams a shell + out-of-order resolved
fragments; the client parses the shell and swaps each fragment into its boundary.
The mini-DOM's HTML parser + `innerHTML` make this testable headless.
*/
describe('SSR streaming → client swap', () => {
    test('shell paints, then resolved values land in their boundaries', async () => {
        const source = `
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
        `
        const render = (): SsrRender =>
            new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
                doc,
                state,
                derived,
                effect,
            ) as SsrRender

        const host = document.createElement('div')
        let first = true
        for await (const chunk of renderToStream(render)) {
            if (first) {
                host.innerHTML = chunk // parse the pending shell
                first = false
                expect(host.textContent).toContain('loading slow')
                expect(host.textContent).toContain('loading fast')
            } else {
                applyResolved(host, chunk) // swap a resolved fragment into its boundary
            }
        }

        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toBe(
            '<div>' +
                '<!--abide:await:0--><span>SLOW</span><!--/abide:await:0-->' +
                '<!--abide:await:1--><b>FAST</b><!--/abide:await:1-->' +
                '</div>',
        )
        // pending shells are gone; resolved values are in place
        expect(host.textContent).toBe('SLOWFAST')
    })
})
