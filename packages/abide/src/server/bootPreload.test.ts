// The client bundle's DOWNLOAD must not be serialised behind the page's reads.
//
// The boot `<script type="module">` lives in `documentTail`, so on a streamed page the browser used to
// discover the entry only at `responseEnd` — after every deferred read had drained. `documentHead` now
// carries a `modulepreload` for the same entry, and the head flushes with the shell.
//
// These are WORK/ORDERING guards, not output guards (PERFORMANCE.md §5): asserting merely that the
// document contains the loader URL passes against the bug, because the tail always contained it. What
// has to be asserted is that the URL is present in the FIRST flushed chunk, while the read is still
// outstanding. Verified to fail against the bug by removing `bootPreload` from `documentHead` — the
// first chunk then carries the shell and no loader reference.
//
// The graph guard below is the second half, and needs its own ablation: preloading the ENTRY alone
// passes the first guard while leaving the entry's static dependencies to be discovered at execution
// time, which is still after the drain. Verified to fail by narrowing `bootHrefs` to just the entry.

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'

const LOADER = /\/__abide\/chunk\/loader-[a-z0-9]+\.js/

// Read one chunk off a streamed response without draining it.
async function firstChunk(
    response: Response,
): Promise<{ text: string; rest: () => Promise<string> }> {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    const text = decoder.decode((await reader.read()).value)
    return {
        text,
        rest: async () => {
            let out = ''
            for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                out += decoder.decode(value)
            }
            return out
        },
    }
}

test('the boot entry is discoverable in the FIRST flushed chunk, before a slow read drains', async () => {
    // Gated rather than timed: the assertion is "the shell flushed and the read has NOT landed", which a
    // sleep only wins while the box is idle (mirrors pages.test.ts).
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const app = await createTestApp({
        routes: {
            slow: GET(async () => {
                await gate
                return 'DRAINED'
            }),
        },
        pages: {
            '/': "<script>import slow from 'abide-rpc:slow'</script><main>{#await slow()}<i>pending</i>{:then v}<p>{v}</p>{/await}</main>",
        },
    })

    const response = await app.fetch('/')
    const { text: shell, rest } = await firstChunk(response)

    // The page is genuinely streaming: the shell carries the placeholder and the read is still open.
    expect(shell).toContain('<i>pending</i>')
    expect(shell).not.toContain('DRAINED')

    // …and the browser can already start fetching the client bundle.
    const preloaded = shell.match(LOADER)
    expect(preloaded).not.toBeNull()
    expect(shell).toContain(`<link rel="modulepreload" href="${preloaded?.[0]}">`)

    // The executing tag still arrives last, and names the SAME entry — preload, not a moved script.
    release()
    const tail = await rest()
    expect(tail).toContain(`<script type="module" src="${preloaded?.[0]}"></script>`)
    expect(tail).toContain('DRAINED')

    await app.stop()
})

test('the preloaded set is CLOSED under static imports — no chunk is discovered at execution time', async () => {
    // TWO pages on purpose. With a single page every chunk the route needs is already in the boot
    // graph, so the route-chunk half of this invariant is unfalsifiable — verified: ablating the route
    // chunk's dependencies still passed. A second page makes Bun factor a shared chunk that the ROUTE
    // chunks import and the entry does not, which is the edge the guard has to be able to see.
    const app = await createTestApp({
        pages: {
            '/': "<script>import { state } from 'abide/shared/state'; let n = state(0)</script><button onclick={() => n++}>{n}</button>",
            '/other':
                "<script>import { state } from 'abide/shared/state'; let m = state(1)</script><i>{m}</i>",
        },
    })

    const body = await (await app.fetch('/')).text()
    const head = body.slice(0, body.indexOf('</head>'))
    const preloaded = new Set(
        [...head.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1] as string),
    )
    // The shape above must actually produce a route chunk with a dependency of its own, or the walk
    // below proves nothing. Four preloads = entry + its dep + route chunk + the route's shared chunk.
    expect(preloaded.size).toBeGreaterThan(3)

    const entryHref = body.match(
        /<script type="module" src="(\/__abide\/chunk\/loader-[a-z0-9]+\.js)"><\/script>/,
    )?.[1]
    expect(entryHref).toBeDefined()
    expect(preloaded.has(entryHref as string)).toBe(true)

    // Closure, not a spot check: walk what each preloaded chunk itself statically imports and require
    // that to be preloaded too. Anything reachable by a static edge but absent from the head is a chunk
    // the browser cannot learn about until something executes — and since the executing `<script>` is in
    // the tail, "executes" means after the whole document has drained. Stating it as an invariant is
    // what makes it survive a change in how the bundle happens to be split; the earlier spot check on
    // the entry's imports passed while the ROUTE chunk's two static imports were still stranded.
    //
    // A quote directly after `from`/`import` is what excludes `import(...)` — the dynamic edges are
    // other routes' code and are deliberately NOT preloaded.
    const statics = /(?:\bfrom|\bimport)\s*["'](\/__abide\/chunk\/[^"']+)["']/g
    for (const href of preloaded) {
        if (!href.endsWith('.js')) continue
        const source = await (await app.fetch(href)).text()
        statics.lastIndex = 0
        for (;;) {
            const match = statics.exec(source)
            if (match === null) break
            expect(preloaded.has(match[1] as string)).toBe(true)
        }
    }

    await app.stop()
})

test('the boot entry is preloaded BEFORE the route chunk it imports', async () => {
    const app = await createTestApp({ pages: { '/': '<h1>ok</h1>' } })

    const body = await (await app.fetch('/')).text()
    const head = body.slice(0, body.indexOf('</head>'))
    const preloads = [...head.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(
        (m) => m[1],
    )

    // The entry is the route chunk's importer, so preloading the child first leaves it idle until the
    // parent arrives. Order is the guarantee; a page with no route chunk simply has the one entry.
    expect(preloads.length).toBeGreaterThan(0)
    expect(preloads[0]).toMatch(LOADER)

    await app.stop()
})
