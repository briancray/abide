import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attach } from '../src/lib/ui/dom/attach.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Probes the attachment lifecycle: `mounted` records the node passed in at build,
   `torn` records the node its teardown ran for. */
let mountedWith: Element[] = []
let tornWith: Element[] = []
const mounted = (node: Element): void => {
    mountedWith.push(node)
}
const torn = (node: Element): void => {
    tornWith.push(node)
}

const RUNTIME = {
    doc,
    state,
    openChild,
    appendText,
    appendStatic,
    attr,
    on,
    attach,
    mounted,
    torn,
}

const SOURCE = `<main><div attach={(node) => { mounted(node); return () => torn(node) }}></div></main>`

function build(host: Element): () => void {
    const names = ['host', ...Object.keys(RUNTIME)]
    const body = compileComponent(SOURCE)
    return mount(host, (target) => {
        new Function(...names, body)(target, ...Object.values(RUNTIME))
    })
}

describe('attach binding', () => {
    test('runs the attachment with the element and tears it down on dispose', () => {
        mountedWith = []
        tornWith = []
        const host = document.createElement('div')
        const dispose = build(host)
        expect(mountedWith.length).toBe(1) // attachment ran once at build
        const div = mountedWith[0] as Element
        expect(div.tagName.toLowerCase()).toBe('div') // ...with its own element
        expect(tornWith).toEqual([]) // teardown not yet run
        dispose()
        expect(tornWith).toEqual([div]) // owner scope ran the teardown, same node
    })

    test('SSR strips the attachment — no attribute emitted, body never runs', () => {
        mountedWith = []
        const names = [...Object.keys(RUNTIME), 'model']
        const render = new Function(...names, compileSSR(SOURCE))(
            ...Object.values(RUNTIME),
            doc({}),
        ) as SsrRender
        expect(render.html).toContain('<div></div>') // no `attach` attribute leaked into markup
        expect(render.html).not.toContain('attach')
        expect(mountedWith).toEqual([]) // attachment is client-only
    })
})
