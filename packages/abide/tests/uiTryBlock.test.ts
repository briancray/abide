import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { tryBlock } from '../src/lib/ui/dom/tryBlock.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* A thunk the markup can call to throw deterministically during build. */
const boom = (): string => {
    throw 'kaboom'
}

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    tryBlock,
    boom,
}

function ssr(source: string, $$model: unknown): SsrRender {
    return new Function(...Object.keys(RUNTIME), '$$model', compileSSR(source))(
        ...Object.values(RUNTIME),
        $$model,
    ) as SsrRender
}

function run(source: string, host: Element, $$model: unknown, mode: 'mount' | 'hydrate'): void {
    const body = compileComponent(source)
    const fn = (target: Element) => {
        new Function('host', ...Object.keys(RUNTIME), '$$model', body)(
            target,
            ...Object.values(RUNTIME),
            $$model,
        )
    }
    if (mode === 'hydrate') {
        hydrate(host, fn)
    } else {
        fn(host)
    }
}

const SUCCESS = `<main>{#try}<p>{$$model.label}</p>{:catch error}<b>{error}</b>{/try}</main>`
const THROW = `<main>{#try}<p>{boom()}</p>{:catch error}<b>caught:{error}</b>{/try}</main>`
const NO_CATCH = `<main>{#try}<p>{boom()}</p>{/try}</main>`

describe('<template try> (sync error boundary)', () => {
    test('client: success renders the guarded subtree', () => {
        const host = document.createElement('div')
        run(SUCCESS, host, doc({ label: 'hi' }), 'mount')
        expect(host.textContent).toBe('hi')
    })

    test('client: a throw while building swaps to catch, error bound', () => {
        const host = document.createElement('div')
        run(THROW, host, doc({}), 'mount')
        expect(host.textContent).toBe('caught:kaboom')
    })

    test('client: no catch re-throws (propagates past the boundary)', () => {
        const host = document.createElement('div')
        expect(() => run(NO_CATCH, host, doc({}), 'mount')).toThrow('kaboom')
    })

    test('client: inner catch handles, outer never sees it', () => {
        const NESTED = `<main>{#try}<div>{#try}<p>{boom()}</p>{:catch i}<b>inner:{i}</b>{/try}</div>{:catch o}<b>outer:{o}</b>{/try}</main>`
        const host = document.createElement('div')
        run(NESTED, host, doc({}), 'mount')
        expect(host.textContent).toBe('inner:kaboom')
    })

    test('client: an uncaught inner throw propagates to the outer catch', () => {
        const NESTED = `<main>{#try}<div>{#try}<p>{boom()}</p>{/try}</div>{:catch o}<b>outer:{o}</b>{/try}</main>`
        const host = document.createElement('div')
        run(NESTED, host, doc({}), 'mount')
        expect(host.textContent).toBe('outer:kaboom')
    })

    test('client: finally renders on both success and catch', () => {
        const FIN = `<main>{#try}<p>{$$model.label}</p>{:catch e}<b>{e}</b>{:finally}<i>fin</i>{/try}</main>`
        const ok = document.createElement('div')
        run(FIN, ok, doc({ label: 'hi' }), 'mount')
        expect(ok.textContent).toBe('hifin')
        const bad = document.createElement('div')
        run(FIN.replace('{$$model.label}', '{boom()}'), bad, doc({}), 'mount')
        expect(bad.textContent).toBe('kaboomfin')
    })

    test('SSR: success renders guarded markup inside boundary + range comments', () => {
        const html = ssr(SUCCESS, doc({ label: 'hi' })).html
        expect(html).toBe(
            '<main><!--a--><!--abide:try:0--><!--[--><p>hi</p><!--]--><!--/abide:try:0--></main>',
        )
    })

    test('SSR: a throw renders catch markup, truncating the partial', () => {
        const html = ssr(THROW, doc({})).html
        expect(html).toBe(
            '<main><!--a--><!--abide:try:0--><!--[--><b>caught:kaboom</b><!--]--><!--/abide:try:0--></main>',
        )
    })

    test('SSR: no catch propagates the throw (becomes a 500 upstream)', () => {
        expect(() => ssr(NO_CATCH, doc({})).html).toThrow('kaboom')
    })

    test('hydrate: success adopts the guarded node in place', () => {
        const $$model = doc({ label: 'hi' })
        const host = document.createElement('div')
        host.innerHTML = ssr(SUCCESS, $$model).html
        const main = host.childNodes[0] as unknown as { childNodes: unknown[]; textContent: string }
        run(SUCCESS, host, $$model, 'hydrate')
        expect(main.textContent).toBe('hi')
    })

    test('hydrate: a server-caught boundary rebuilds the catch fresh', () => {
        const $$model = doc({})
        const host = document.createElement('div')
        host.innerHTML = ssr(THROW, $$model).html // server already rendered the catch branch
        run(THROW, host, $$model, 'hydrate') // client guard throws too → discard + rebuild
        expect(host.textContent).toBe('caught:kaboom')
    })
})
