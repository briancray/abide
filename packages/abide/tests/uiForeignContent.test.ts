import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { appendTextAt } from '../src/lib/ui/dom/appendTextAt.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { cloneStatic } from '../src/lib/ui/dom/cloneStatic.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { skeleton } from '../src/lib/ui/dom/skeleton.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'

/* A `<svg>` carrying a binding builds through the parser-backed `skeleton` (the only
   tree-builder now), which parses its markup inside a matching foreign wrapper
   (`foreignWrapperTag`) so `<circle>`/`<path>` land in the SVG namespace — the bug the
   imperative path used to hit. A fully-static sibling svg proves the clone path too. */
const BOUND_SVG = `
<script>import { state } from '@abide/abide/ui/state'

  let size = state(24)
</script>
<svg width={size} viewBox="0 0 24 24"><path d="M0 0"/><circle cx="12"/></svg>
`

/* The runtime names a compiled build body can reference. The build pulls only what
   it needs by name; extras are harmless. */
function runBuild(source: string, host: Element, hydrating: boolean): void {
    const body = compileComponent(source)
    const runtime = {
        doc,
        state,
        computed,
        effect,
        cloneStatic,
        skeleton,
        attr,
        on,
        appendText,
        appendTextAt,
        appendStatic,
        when,
        each,
        awaitBlock,
    }
    const names = Object.keys(runtime)
    const run = (target: Element): void => {
        new Function('host', ...names, body)(
            target,
            ...names.map((name) => runtime[name as keyof typeof runtime]),
        )
    }
    if (hydrating) {
        hydrate(host, run)
    } else {
        run(host)
    }
}

let reset: () => void
beforeAll(() => {
    reset = installHappyDom()
})
afterAll(() => {
    reset()
})

describe('foreign content (real parser) — SVG namespace', () => {
    test('client CREATE: a bound <svg> and its children land in the SVG namespace', () => {
        const host = document.createElement('div')
        runBuild(BOUND_SVG, host, false)
        const svg = host.querySelector('svg') as Element
        const path = host.querySelector('path') as Element
        expect(svg.namespaceURI).toBe(SVG_NS)
        expect(path.namespaceURI).toBe(SVG_NS)
    })

    test('client HYDRATE: claiming server SVG markup keeps the SVG namespace', () => {
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(BOUND_SVG))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string }
        const host = document.createElement('div')
        host.innerHTML = server.html
        runBuild(BOUND_SVG, host, true)
        const path = host.querySelector('path') as Element
        expect(path.namespaceURI).toBe(SVG_NS)
    })
})

/* The hole lives on a DESCENDANT, not the foreign root: `<svg>` is static but its
   `<path>` carries a binding. The whole foreign subtree must still route through the
   parser, or the static `<svg>` builds in the HTML namespace. */
const STATIC_SVG_DYNAMIC_CHILD = `
<script>import { state } from '@abide/abide/ui/state'

  let color = state('red')
</script>
<svg viewBox="0 0 24 24"><path fill={color} d="M0 0"/></svg>
`

/* A foreign subtree nested under a static HTML element with a hole deeper still. */
const NESTED_SVG = `
<script>import { state } from '@abide/abide/ui/state'

  let r = state(6)
</script>
<div class="icon"><svg viewBox="0 0 24 24"><circle r={r} cx="12"/></svg></div>
`

describe('foreign content — holes on descendants', () => {
    test('CREATE: a static <svg> with a bound <path> child keeps the SVG namespace', () => {
        const host = document.createElement('div')
        runBuild(STATIC_SVG_DYNAMIC_CHILD, host, false)
        expect((host.querySelector('svg') as Element).namespaceURI).toBe(SVG_NS)
        expect((host.querySelector('path') as Element).namespaceURI).toBe(SVG_NS)
    })

    test('CREATE: a foreign subtree nested in static HTML keeps the SVG namespace', () => {
        const host = document.createElement('div')
        runBuild(NESTED_SVG, host, false)
        expect((host.querySelector('div') as Element).namespaceURI).not.toBe(SVG_NS)
        expect((host.querySelector('circle') as Element).namespaceURI).toBe(SVG_NS)
    })
})

/* Reactive text inside foreign content: `<text>` holds a dynamic child, so the `<svg>`
   builds through `skeleton`, which must namespace the foreign elements off their parent
   (parsed inside the SVG wrapper) while binding the text on the located `<text>` node. */
const SVG_REACTIVE_TEXT = `
<script>import { state } from '@abide/abide/ui/state'

  let label = state('hi')
</script>
<svg viewBox="0 0 24 24"><text x="0">{label}</text></svg>
`

/* A foreign parent built dynamically (it has a control-flow child) with a static
   foreign sibling that coalesces into a cloneStatic run — the wrapper-less run must
   still parse into the foreign namespace. */
const SVG_MIXED_STATIC = `
<script>import { state } from '@abide/abide/ui/state'

  let show = state(true)
</script>
<svg viewBox="0 0 24 24"><path d="M0 0"/>{#if show}<circle cx="12"/>{/if}</svg>
`

/* An each that generates foreign elements: each row's `<circle>` is built into a
   detached fragment before insertion, so the each must carry the ambient namespace. */
const SVG_EACH = `
<script>import { state } from '@abide/abide/ui/state'

  let rs = state([2, 4, 6])
</script>
<svg viewBox="0 0 24 24">{#for r of rs by r}<circle r={r}/>{/for}</svg>
`

/* An await whose resolved branch is foreign — the branch builds into a fragment in
   an async callback, after the synchronous mount returns. */
const SVG_AWAIT = `
<script>
  let load = () => Promise.resolve(8)
</script>
<svg viewBox="0 0 24 24">{#await load()}<circle cx="1"/>{:then v}<circle r={v}/>{/await}</svg>
`

describe('foreign content — dynamically-built parents with dynamic children', () => {
    test('CREATE: reactive text under <svg> keeps elements in the SVG namespace', () => {
        const host = document.createElement('div')
        runBuild(SVG_REACTIVE_TEXT, host, false)
        expect((host.querySelector('svg') as Element).namespaceURI).toBe(SVG_NS)
        expect((host.querySelector('text') as Element).namespaceURI).toBe(SVG_NS)
        expect((host.querySelector('text') as Element).textContent).toBe('hi')
    })

    test('CREATE: a static cloneStatic run under a dynamically-built <svg> stays SVG', () => {
        const host = document.createElement('div')
        runBuild(SVG_MIXED_STATIC, host, false)
        expect((host.querySelector('path') as Element).namespaceURI).toBe(SVG_NS)
    })

    test('CREATE: an element generated by a {#if} inside <svg> stays SVG', () => {
        const host = document.createElement('div')
        runBuild(SVG_MIXED_STATIC, host, false)
        // `<circle>` is built by the if-block into a detached fragment, then inserted.
        expect((host.querySelector('circle') as Element).namespaceURI).toBe(SVG_NS)
    })

    test('CREATE: elements generated by an each inside <svg> stay SVG', () => {
        const host = document.createElement('div')
        runBuild(SVG_EACH, host, false)
        const circles = host.querySelectorAll('circle')
        expect(circles.length).toBe(3)
        for (const circle of circles) {
            expect(circle.namespaceURI).toBe(SVG_NS)
        }
    })

    test('CREATE: an await branch resolving foreign content stays SVG', async () => {
        const host = document.createElement('div')
        runBuild(SVG_AWAIT, host, false)
        await Promise.resolve()
        await Promise.resolve()
        expect((host.querySelector('circle') as Element).namespaceURI).toBe(SVG_NS)
    })
})

/* A control-flow block with a static SUFFIX after it: on create the block must insert
   before the suffix (not append at the parent's end); on hydrate it claims its range and
   the suffix is claimed structure. */
const SUFFIX_IF = `
<script>import { state } from '@abide/abide/ui/state'

  let on = state(true)
</script>
<p>{#if on}<b>shown</b>{/if} the tail</p>
`

describe('control flow with a static suffix', () => {
    test('CREATE: the block lands before the suffix, in order', () => {
        const host = document.createElement('div')
        runBuild(SUFFIX_IF, host, false)
        // <p> contains the if's <b>, then the static " the tail" text — in that order
        expect((host.querySelector('p') as Element).textContent).toBe('shown the tail')
        expect((host.querySelector('p') as Element).lastChild?.textContent).toBe(' the tail')
    })

    test('HYDRATE: adopts the branch and suffix in place (no duplication)', () => {
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(SUFFIX_IF))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string }
        const host = document.createElement('div')
        host.innerHTML = server.html
        const bBefore = host.querySelector('b') as Element
        runBuild(SUFFIX_IF, host, true)
        expect(host.querySelector('b') as Element).toBe(bBefore) // branch adopted, not rebuilt
        expect(host.querySelectorAll('b').length).toBe(1) // no duplication
        expect((host.querySelector('p') as Element).textContent).toBe('shown the tail') // order kept
    })
})

/* A control-flow block after a static element prefix: the whole <div> is one skeleton
   clone; on hydrate `cursorAfterElements` must skip the <h2>/<p> prefix so the if claims
   its server range, not the prefix. */
const PREFIXED_IF = `
<script>import { state } from '@abide/abide/ui/state'

  let on = state(true)
</script>
<div class="card"><h2>Title</h2><p>Body</p>{#if on}<span>shown</span>{/if}</div>
`

describe('control flow with a static prefix (skeleton + cursorAfterElements)', () => {
    test('HYDRATE: adopts the prefix and the if branch in place (no duplication)', () => {
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(PREFIXED_IF))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string }
        const host = document.createElement('div')
        host.innerHTML = server.html
        const h2Before = host.querySelector('h2') as Element
        const spanBefore = host.querySelector('span') as Element
        runBuild(PREFIXED_IF, host, true)
        expect(host.querySelector('h2') as Element).toBe(h2Before) // prefix adopted, not rebuilt
        expect(host.querySelector('span') as Element).toBe(spanBefore) // if branch adopted
        expect(host.querySelectorAll('span').length).toBe(1) // no duplication
        expect((host.querySelector('span') as Element).textContent).toBe('shown')
    })
})

describe('skeleton primitive — parser-backed create + hydrate', () => {
    const MARKED = '<svg data-abide-hole="0" viewBox="0 0 24 24"><path d="M0 0"/></svg>'

    test('CREATE: clones into the SVG namespace and returns the hole element', () => {
        const host = document.createElement('div')
        const holes = skeleton(host, MARKED)
        const svg = host.querySelector('svg') as Element
        expect(holes.el[0]).toBe(svg) // element hole 0 resolves to the marked <svg>
        expect(svg.namespaceURI).toBe(SVG_NS)
        expect((host.querySelector('path') as Element).namespaceURI).toBe(SVG_NS)
        expect(svg.hasAttribute('data-abide-hole')).toBe(false) // marker stripped
    })

    test('locates a comment anchor alongside an element hole', () => {
        const host = document.createElement('div')
        // el[0] = the <div> (attr hole, marker stripped); an[0] = the <!--a--> anchor
        const holes = skeleton(host, '<div data-abide-hole>x<!--a-->y</div>')
        expect(holes.el[0].tagName.toLowerCase()).toBe('div')
        expect(holes.el[0].hasAttribute('data-abide-hole')).toBe(false)
        expect((holes.an[0] as Comment).data).toBe('a') // anchor kept, found by scan
        expect(holes.an[0].previousSibling?.textContent).toBe('x')
        expect(holes.an[0].nextSibling?.textContent).toBe('y')
    })

    test('text hole CREATE: mounts reactive text at the anchor and updates', () => {
        const host = document.createElement('div')
        const name = state('world')
        const holes = skeleton(host, '<p>Hello <!--a-->!</p>')
        appendTextAt(holes.an[0], () => name.value)
        expect(host.textContent).toBe('Hello world!')
        name.value = 'there'
        expect(host.textContent).toBe('Hello there!')
    })

    test('text hole HYDRATE: claims the server value, splits trailing static, updates', () => {
        const host = document.createElement('div')
        // server shape: anchor delimits the value; trailing "!" merges into the value node
        host.innerHTML = '<p>Hello <!--a-->world!</p>'
        const name = state('world')
        hydrate(host, (target) => {
            const holes = skeleton(target, '<p>Hello <!--a-->!</p>')
            appendTextAt(holes.an[0], () => name.value)
        })
        expect(host.textContent).toBe('Hello world!')
        name.value = 'there'
        expect(host.textContent).toBe('Hello there!') // value swapped, "!" preserved
    })

    test('HYDRATE: claims existing server nodes and locates the same hole', () => {
        const host = document.createElement('div')
        host.innerHTML = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'
        const serverSvg = host.querySelector('svg') as Element
        let claimed: ReturnType<typeof skeleton> | undefined
        hydrate(host, (target) => {
            claimed = skeleton(target, MARKED)
        })
        expect(claimed?.el[0]).toBe(serverSvg) // adopted the server node, not a clone
        expect(host.querySelectorAll('svg').length).toBe(1) // no duplication
        expect((host.querySelector('path') as Element).namespaceURI).toBe(SVG_NS)
    })
})
