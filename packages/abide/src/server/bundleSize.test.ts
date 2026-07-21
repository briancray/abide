// M3b / PR7 — the browser bundle must NOT contain the TypeScript compiler, NOR the `.abide`
// interpreter. Pre-PR7 the browser re-parsed `.abide` source at runtime (parse.ts + renderClient.ts +
// mountPrepared.ts shipped, TS7-free but heavy); PR7 ships each page's AOT-emitted client mount
// instead, so parse/compile happen only at build time. This proves the served client assets are free
// of TS7 AND the interpreter, and are now far smaller than the pre-PR7 bundle, while the emitted client
// mount still works reactively under happy-dom.
//
// TODO #6: the client is now code-split — the document boots a content-hashed loader entry that lazily
// imports each route's chunk. `fetchClientGraph` walks the whole served module graph (loader entry →
// static + dynamic chunk imports) so the size/no-TS7 assertions cover ALL shipped bytes, not one file.

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import type { TestApp } from '../test/createTestApp.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { bootstrapPage } from '../ui/internal/bootstrap.ts'
import { loadEmitted } from '../ui/internal/emit.ts'

// Yield to the microtask queue so batched reactive effects flush.
function tick(): Promise<void> {
    return Promise.resolve()
}

// Fetch the full served client module graph: the document's loader `<script src>`, then transitively
// every `/__abide/chunk/*.js` it (and each chunk) references (static + dynamic imports). Returns the
// concatenated bytes so the assertions below see the WHOLE app's client code across all chunks.
async function fetchClientGraph(app: TestApp): Promise<string> {
    const doc = await (await app.fetch('/')).text()
    const entry = doc.match(/src="(\/__abide\/chunk\/[^"]+\.js)"/)
    if (entry === null) throw new Error('no client loader script in document')
    const seen = new Set<string>()
    const queue = [entry[1] as string]
    let all = ''
    while (queue.length > 0) {
        const next = queue.pop()
        if (next === undefined || seen.has(next)) continue
        seen.add(next)
        const text = await (await app.fetch(next)).text()
        all += `${text}\n`
        for (const ref of text.matchAll(/\/__abide\/chunk\/[^"'()\s]+\.js/g)) queue.push(ref[0])
    }
    return all
}

test('the served client bundle contains no TypeScript compiler and is small', async () => {
    const app = createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
        },
    })

    const body = await fetchClientGraph(app)

    // No TS7 compiler surfaces dragged into the browser bundle.
    expect(body).not.toContain('SyntaxKind')
    expect(body).not.toContain('createScanner')
    expect(body).not.toContain('typescript')

    // PR7: the `.abide` interpreter (re-parse + re-compile in the browser) no longer ships — the page
    // arrives pre-compiled as an emitted client mount.
    expect(body).not.toContain('compileClient')
    expect(body).not.toContain('mountPrepared')

    // Whole-app client bytes (loader + all chunks) for a hello-world page. The bound guards regressions
    // against the heavy items above (TS7 compiler / `.abide` interpreter), not incidental KBs. History:
    // 50→52 KB (Promise-read settled hint); 52→58 KB (ReplayableStream primitive); 58→62 KB (stream cache
    // accounting/cap); 62→64 KB (biome conformance); 64→70 KB (TODO #6 code-splitting adds per-chunk
    // module glue + a shared-chunk boilerplate wrapper); 70→78 KB (client sockets: the isomorphic
    // `Socket` proxy + reactive probe surface + the shared reconnecting mux, shipped alongside the RPC
    // proxy for every app). FUTURE (TODO #3): extract the server-only byte-accounting/pin/cap +
    // shared-cache path out of the isomorphic cell to shrink the client floor.
    const bytes = Buffer.byteLength(body, 'utf8')
    expect(bytes).toBeLessThan(78_000)

    // Still a real bundle that boots the app and carries the AOT client mount runtime path.
    expect(body).toContain('bootstrapPage')
    expect(body).toContain('interpolate')

    await app.stop()
})

test("the SSR'd page injects the content-hashed client loader script tag", async () => {
    const app = createTestApp({ pages: { '/': '<h1>ok</h1>' } })
    const response = await app.fetch('/')
    const body = await response.text()
    // A content-hashed loader entry under /__abide/chunk/ (no longer the fixed /__abide/client.js).
    expect(body).toMatch(
        /<script type="module" src="\/__abide\/chunk\/loader-[a-z0-9]+\.js"><\/script>/,
    )
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
