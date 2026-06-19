import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { eachAsync } from '../src/lib/ui/dom/eachAsync.ts'
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
    attr,
    eachAsync,
}

/* Mount a component on the client and return its host. */
function mount(source: string, model: unknown): HTMLElement {
    const host = document.createElement('div')
    new Function('host', ...Object.keys(RUNTIME), 'model', compileComponent(source))(
        host,
        ...Object.values(RUNTIME),
        model,
    )
    return host
}

/* Run the component's SSR render to one HTML string. */
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

/* An async generator that yields the given rows, one per microtask. */
async function* feed<T>(...rows: T[]): AsyncGenerator<T> {
    for (const row of rows) {
        await Promise.resolve()
        yield row
    }
}

/* Yields the rows, then rejects — a mid-stream failure. */
async function* failingFeed<T>(rows: T[], error: unknown): AsyncGenerator<T> {
    for (const row of rows) {
        await Promise.resolve()
        yield row
    }
    await Promise.resolve()
    throw error
}

const SOURCE = `<ul><template each={model.source} await as="row" key="row.id">
    <li data-id={row.id}>{row.text}</li>
</template></ul>`

const SOURCE_CATCH = `<ul><template each={model.source} await as="row" key="row.id">
    <li data-id={row.id}>{row.text}</li>
    <template catch="err"><li>{err}</li></template>
</template></ul>`

describe('<template each await>', () => {
    test('compiles to eachAsync', () => {
        expect(compileComponent(SOURCE)).toContain('eachAsync(')
    })

    test('parses `each await` as an async each, not an await block', () => {
        expect(compileComponent(SOURCE)).not.toContain('awaitBlock(')
    })

    test('client: rows append as the iterator yields', async () => {
        const host = mount(
            SOURCE,
            doc({ source: feed({ id: 'a', text: 'A' }, { id: 'b', text: 'B' }) }),
        )
        expect(host.textContent).toBe('') // nothing yielded yet
        for (let tick = 0; tick < 6; tick++) {
            await Promise.resolve()
        }
        const list = host.firstChild as Element
        expect([...list.children].map((li) => li.getAttribute('data-id'))).toEqual(['a', 'b'])
        expect(host.textContent).toBe('AB')
    })

    test('client: a re-yielded key updates the row (no duplicate)', async () => {
        const host = mount(
            SOURCE,
            doc({ source: feed({ id: 'a', text: 'A' }, { id: 'a', text: 'A2' }) }),
        )
        for (let tick = 0; tick < 6; tick++) {
            await Promise.resolve()
        }
        const list = host.firstChild as Element
        expect([...list.children]).toHaveLength(1) // same key → one row
        expect(list.children[0]?.textContent).toBe('A2') // rebuilt with the new value
    })

    test('SSR renders no rows (drained on the client)', async () => {
        const html = await ssrStream(SOURCE, doc({ source: feed({ id: 'a', text: 'A' }) }))
        expect(html).not.toContain('<li')
        expect(html).toContain('<ul>')
    })

    test('client: catch branch renders after the streamed rows on rejection', async () => {
        const host = mount(
            SOURCE_CATCH,
            doc({
                source: failingFeed(
                    [
                        { id: 'a', text: 'A' },
                        { id: 'b', text: 'B' },
                    ],
                    'boom',
                ),
            }),
        )
        for (let tick = 0; tick < 12; tick++) {
            await Promise.resolve()
        }
        const list = host.firstChild as Element
        // two streamed rows kept, plus the catch row (which carries no data-id)
        expect([...list.children].map((c) => c.getAttribute('data-id'))).toEqual(['a', 'b', null])
        expect(host.textContent).toBe('ABboom')
    })

    test('compiles a catch branch into a render thunk (not undefined)', () => {
        const out = compileComponent(SOURCE_CATCH)
        expect(out).toContain('eachAsync(')
        expect(out).not.toMatch(/eachAsync\([\s\S]*undefined\);/)
    })
})
