import { beforeAll, describe, expect, test } from 'bun:test'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
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
                {#await slow()}
                    <p>loading slow</p>
                    {:then v}<span>{v}</span>
                {/await}
                {#await fast()}
                    <p>loading fast</p>
                    {:then v}<b>{v}</b>
                {/await}
            </div>
        `
        const render = (): SsrRender =>
            new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
                doc,
                state,
                computed,
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
                '<!--a--><!--abide:await:0--><span>SLOW</span><!--/abide:await:0-->' +
                '<!--a--><!--abide:await:1--><b>FAST</b><!--/abide:await:1-->' +
                '</div>',
        )
        // pending shells are gone; resolved values are in place
        expect(host.textContent).toBe('SLOWFAST')
    })
})
