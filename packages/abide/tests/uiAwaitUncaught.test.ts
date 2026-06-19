import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    awaitBlock,
}

/* Run the component's SSR render and stream it to one HTML string. */
async function ssrStream(source: string, model: unknown): Promise<string> {
    const render = new Function(...Object.keys(RUNTIME), 'model', compileSSR(source))(
        ...Object.values(RUNTIME),
        model,
    ) as SsrRender
    let html = ''
    for await (const chunk of renderToStream(() => render)) {
        html += chunk
    }
    return html
}

/* Streaming await, no catch / no finally → a rejection has nowhere to render. */
const STREAMING = `<main><template await={model.load}>
    <p>loading</p>
    <template then="v"><span>{v}</span></template>
</template></main>`

/* Blocking await (then on the tag), no catch → settles before the first flush. */
const BLOCKING = `<main><template await={model.load} then="v"><span>{v}</span></template></main>`

describe('catch-less <template await> surfaces a rejection', () => {
    test('compiles renderCatch as undefined (no catch branch)', () => {
        // renderCatch is `undefined` (no catch branch); the trailing arg is the block's
        // skeleton insertion reference.
        expect(compileComponent(STREAMING)).toMatch(
            /awaitBlock\([\s\S]*, undefined, anchorCursor\(\w+\)\);/,
        )
    })

    test('SSR streaming: rejection throws out of renderToStream', async () => {
        expect(ssrStream(STREAMING, doc({ load: Promise.reject('boom') }))).rejects.toBe('boom')
    })

    test('SSR blocking: rejection throws before the first flush', async () => {
        expect(ssrStream(BLOCKING, doc({ load: Promise.reject('boom') }))).rejects.toBe('boom')
    })

    test('SSR: resolve still renders normally', async () => {
        const html = await ssrStream(STREAMING, doc({ load: Promise.resolve('ok') }))
        expect(html).toContain('<span>ok</span>')
    })

    /* The client mirror — awaitBlock re-throws when renderCatch is undefined, surfacing
       as an unhandled rejection — can't be asserted here: bun's test runner hard-fails
       on any unhandled rejection regardless of listeners. The wiring is covered by the
       `renderCatch === undefined` compile assertion above. */
})
