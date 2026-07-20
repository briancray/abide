// M3b / PR7 — the browser bundle must NOT contain the TypeScript compiler, NOR the `.abide`
// interpreter. Pre-PR7 the browser re-parsed `.abide` source at runtime (parse.ts + renderClient.ts +
// mountPrepared.ts shipped, TS7-free but heavy); PR7 ships each page's AOT-emitted client mount
// instead, so parse/compile happen only at build time. This proves the served /__abide/client.js is
// free of TS7 AND the interpreter, and is now far smaller than the pre-PR7 bundle, while the emitted
// client mount still works reactively under happy-dom.

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { bootstrapPage } from '../ui/internal/bootstrap.ts'
import { loadEmitted } from '../ui/internal/emit.ts'

// Yield to the microtask queue so batched reactive effects flush.
function tick(): Promise<void> {
    return Promise.resolve()
}

test('the served client bundle contains no TypeScript compiler and is small', async () => {
    const app = createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
        },
    })

    const response = await app.fetch('/__abide/client.js')
    expect(response.status).toBe(200)
    const body = await response.text()

    // No TS7 compiler surfaces dragged into the browser bundle.
    expect(body).not.toContain('SyntaxKind')
    expect(body).not.toContain('createScanner')
    expect(body).not.toContain('typescript')

    // PR7: the `.abide` interpreter (re-parse + re-compile in the browser) no longer ships — the page
    // arrives pre-compiled as an emitted client mount.
    expect(body).not.toContain('compileClient')
    expect(body).not.toContain('mountPrepared')

    // Far smaller now that parse.ts/renderClient.ts/assembleCore no longer ship (was gated < 150 KB;
    // the emitted-mount bundle for a hello-world page is ~31 KB). Tightened bound guards regressions
    // against the heavy items above (TS7 compiler / `.abide` interpreter), not incidental KBs.
    // (Bumped 50 KB → 52 KB for the Promise-read settled-hint helper; 52 KB → 58 KB when the isomorphic
    // cell gained the ReplayableStream primitive; 58 KB → 62 KB for the stream cache accounting/cap wiring
    // — replayable-streams.md §4; 62 KB → 64 KB for the biome-conformance lint pass, whose
    // semantics-preserving restructures (guards / `for…of` / `.call(obj)` replacing non-null assertions)
    // add a few incidental bytes to bundled runtime code. FUTURE: the byte-accounting/pin/cap path is
    // server-only and could be extracted out of the isomorphic cell to shrink the client bundle back down.)
    const bytes = Buffer.byteLength(body, 'utf8')
    expect(bytes).toBeLessThan(64_000)

    // Still a real bundle that boots the app and carries the AOT client mount runtime path.
    expect(body).toContain('bootstrapPage')
    expect(body).toContain('interpolate')

    await app.stop()
})

test("the SSR'd page still injects the client script tag", async () => {
    const app = createTestApp({ pages: { '/': '<h1>ok</h1>' } })
    const response = await app.fetch('/')
    const body = await response.text()
    expect(body).toContain('<script type="module" src="/__abide/client.js"></script>')
    await app.stop()
})

test('bootstrapPage HYDRATES via the TS7-free path (claims server nodes, working reactivity)', async () => {
    const source =
        "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>"
    // PR7: bootstrapPage claims the SSR DOM. Render the real anchored server HTML into the container.
    const { render, hydrate } = await loadEmitted(source)
    const html = await render({ state: (v: unknown) => ({ read: () => v, write() {} }) })
    document.body.innerHTML = `<div id="__abide-app">${html}</div>`

    const container = document.getElementById('__abide-app')
    if (!container) throw new Error('missing __abide-app container')
    const serverSpan = container.querySelector('span')
    if (!serverSpan) throw new Error('missing server span')
    const serverButton = container.querySelector('button')
    if (!serverButton) throw new Error('missing server button')

    const cleanup = bootstrapPage(hydrate, {})

    // Attach proof: hydration claimed the SAME server nodes (no clear, no recreate).
    expect(container.querySelector('span')).toBe(serverSpan)
    expect(container.querySelector('button')).toBe(serverButton)
    expect(serverSpan.textContent).toBe('0')

    serverButton.click()
    await tick()
    expect(serverSpan.textContent).toBe('1')
    expect(container.querySelector('span')).toBe(serverSpan)

    cleanup()
    document.body.innerHTML = ''
})
