import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { cloneStatic } from '../src/lib/ui/dom/cloneStatic.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* A page with deep fully-static subtrees (the nav, the feature list, the footer)
   plus a couple of dynamic holes — the shape static-template cloning targets. */
const PAGE = `
    <script>
        let title = state('Reference')
        let count = state(3)
    </script>
    <main class="page">
        <header>
            <nav><ul><li><a href="/">Home</a></li><li><a href="/docs">Docs</a></li></ul></nav>
            <h1>{title}</h1>
        </header>
        <ul class="features">
            <li><span class="bullet">•</span> No barrels</li>
            <li><span class="bullet">•</span> Bun-native</li>
        </ul>
        <p>Active: {count}</p>
        <footer><small>© abide</small></footer>
    </main>
`

const RUNTIME = {
    doc,
    state,
    derived,
    effect,
    openChild,
    openRoot,
    appendText,
    appendStatic,
    attr,
    on,
    each,
    when,
    cloneStatic,
}
const NAMES = Object.keys(RUNTIME)
const VALUES = NAMES.map((name) => RUNTIME[name as keyof typeof RUNTIME])

function runBody(host: Element, body: string): void {
    new Function('host', ...NAMES, body)(host, ...VALUES)
}

function serverHtml(source: string): string {
    return (
        new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
    ).html
}

describe('static-template cloning', () => {
    test('emits cloneStatic for fully-static subtrees, not for dynamic ones', () => {
        const body = compileComponent(PAGE)
        /* The static nav, feature list, and footer each clone in one call (the html
           is JSON-escaped inside the emitted call, so anchor on quote-free fragments). */
        expect(body).toContain('cloneStatic(')
        expect(body).toContain('<nav><ul><li>')
        expect(body).toContain('<footer><small>© abide</small></footer>')
        /* The dynamic holes stay imperative. */
        expect(body).toContain('appendText(')
        /* No openChild for the cloned static interior (the <nav>, <small>, bullets). */
        expect(body).not.toContain('"nav"')
        expect(body).not.toContain('"small"')
    })

    test('create-mode DOM is byte-identical to the server markup', () => {
        const host = document.createElement('div')
        runBody(host, compileComponent(PAGE))
        const serialize = (globalThis as unknown as { serializeMiniDom: (n: Element) => string })
            .serializeMiniDom
        expect(serialize(host)).toBe(serverHtml(PAGE))
    })

    test('hydration adopts the cloned static subtrees in place (no duplication) and stays reactive', () => {
        const host = document.createElement('div')
        host.innerHTML = serverHtml(PAGE)
        const mainBefore = host.childNodes[0]
        const navBefore = (mainBefore as unknown as { childNodes: unknown[] }).childNodes[0]

        hydrate(host, (target) => runBody(target, compileComponent(PAGE)))

        // adopted, not rebuilt: same node identities, one <main>
        expect(host.childNodes.length).toBe(1)
        expect(host.childNodes[0]).toBe(mainBefore)
        expect((mainBefore as unknown as { childNodes: unknown[] }).childNodes[0]).toBe(navBefore)
        // the dynamic hole wired in place
        expect((host as unknown as { textContent: string }).textContent).toContain('Active: 3')
        expect((host as unknown as { textContent: string }).textContent).toContain('Reference')
    })

    test('a static run coalesces consecutive siblings into one clone', () => {
        const body = compileComponent(`
            <div>
                <span class="a">A</span>
                <span class="b">B</span>
                <span class="c">C</span>
            </div>
        `)
        const clones = body.match(/cloneStatic\(/g) ?? []
        /* The whole <div> is static, so it (with its three spans and the whitespace
           between them) collapses to a single clone. */
        expect(clones.length).toBe(1)
        expect(body).toContain('>A</span>')
        expect(body).toContain('>B</span>')
        expect(body).toContain('>C</span>')
    })
})
