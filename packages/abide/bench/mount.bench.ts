import { installMiniDom } from '../tests/support/installMiniDom.ts'
import { emitMetric } from './emitMetric.ts'

installMiniDom()

const { compileComponent } = await import('../src/lib/ui/compile/compileComponent.ts')
const { doc } = await import('../src/lib/ui/doc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { derived } = await import('../src/lib/ui/derived.ts')
const { effect } = await import('../src/lib/ui/effect.ts')
const { mount } = await import('../src/lib/ui/dom/mount.ts')
const { openChild } = await import('../src/lib/ui/dom/openChild.ts')
const { appendText } = await import('../src/lib/ui/dom/appendText.ts')
const { appendStatic } = await import('../src/lib/ui/dom/appendStatic.ts')
const { attr } = await import('../src/lib/ui/dom/attr.ts')
const { on } = await import('../src/lib/ui/dom/on.ts')
const { each } = await import('../src/lib/ui/dom/each.ts')
const { when } = await import('../src/lib/ui/dom/when.ts')
const { mountChild } = await import('../src/lib/ui/dom/mountChild.ts')
const { cloneStatic } = await import('../src/lib/ui/dom/cloneStatic.ts').catch(() => ({
    cloneStatic: undefined,
}))
const { skeleton } = await import('../src/lib/ui/dom/skeleton.ts').catch(() => ({
    skeleton: undefined,
}))
const { appendTextAt } = await import('../src/lib/ui/dom/appendTextAt.ts').catch(() => ({
    appendTextAt: undefined,
}))
const { cursorAfterElements } = await import('../src/lib/ui/dom/cursorAfterElements.ts').catch(
    () => ({ cursorAfterElements: undefined }),
)

/*
Mount-cost benchmark: how fast a content-heavy component builds its DOM in CREATE
mode (a client navigation / fresh client render — NOT hydration, which adopts).
Most of the page here is static structure with a few dynamic holes — the shape
where static-template cloning (one cloneNode vs N createElement/append calls)
should win. This is the gate for that codegen change. Run:

  bun packages/abide/bench/mount.bench.ts
*/

/* A docs-shaped page: deep static chrome + lists, a couple of dynamic holes. */
const PAGE = `
    <script>
        let title = state('Reference')
        let count = state(3)
    </script>
    <main class="page">
        <header class="masthead">
            <nav class="topnav">
                <ul class="links">
                    <li><a href="/">Home</a></li>
                    <li><a href="/docs">Docs</a></li>
                    <li><a href="/api">API</a></li>
                    <li><a href="/blog">Blog</a></li>
                </ul>
            </nav>
            <h1 class="heading">{title}</h1>
        </header>
        <section class="content">
            <article class="prose">
                <h2>Overview</h2>
                <p>The framework is type-safe and isomorphic, built on web standards.</p>
                <p>Same callable, same name, same behaviour on both sides.</p>
                <ul class="features">
                    <li><span class="bullet">•</span> No barrels</li>
                    <li><span class="bullet">•</span> Bun-native APIs</li>
                    <li><span class="bullet">•</span> Small surface</li>
                    <li><span class="bullet">•</span> High visibility</li>
                </ul>
                <pre class="code"><code>const x = 1</code></pre>
                <p>Active sections: {count}</p>
            </article>
            <aside class="sidebar">
                <h3>On this page</h3>
                <ol class="toc">
                    <li><a href="#overview">Overview</a></li>
                    <li><a href="#install">Install</a></li>
                    <li><a href="#usage">Usage</a></li>
                </ol>
            </aside>
        </section>
        <footer class="foot"><small>© abide</small></footer>
    </main>
`

const body = compileComponent(PAGE)
const runtime = {
    doc,
    state,
    derived,
    effect,
    openChild,
    appendText,
    appendStatic,
    attr,
    on,
    each,
    when,
    mountChild,
    cloneStatic,
    skeleton,
    appendTextAt,
    cursorAfterElements,
}
const names = Object.keys(runtime)
const values = names.map((name) => runtime[name as keyof typeof runtime])

function mountOnce(): number {
    const host = document.createElement('div')
    const start = performance.now()
    mount(host, (target) => {
        new Function('host', ...names, body)(target, ...values)
    })
    return performance.now() - start
}

const sample = (globalThis as { serializeMiniDom?: (n: unknown) => string }).serializeMiniDom
const host = document.createElement('div')
mount(host, (target) => new Function('host', ...names, body)(target, ...values))
console.log(`\nmount cost — ${sample ? sample(host).length : '?'} bytes of DOM (create mode)\n`)

/* Warm the JIT. */
for (let warm = 0; warm < 200; warm += 1) {
    mountOnce()
}

const MOUNTS = 20_000
let total = 0
for (let pass = 0; pass < MOUNTS; pass += 1) {
    total += mountOnce()
}
console.log(
    `${MOUNTS} mounts            ${total.toFixed(1).padStart(8)}ms   ${((total / MOUNTS) * 1000).toFixed(2).padStart(8)}µs/mount`,
)
emitMetric('mount.page', (total / MOUNTS) * 1000, 'us/mount')
console.log()
