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
    const app = await createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/shared/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
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
    // proxy for every app); 78→80 KB (`interpolate` adopts server-rendered mountable subtrees on hydrate
    // — `{#component}` call / `{children()}` — instead of stranding them). FUTURE (TODO #3): extract the
    // server-only byte-accounting/pin/cap + shared-cache path out of the isomorphic memo to shrink the
    // client floor.
    // NOTE: temporarily raised 80 KB → 100 KB → 110 KB → 112 KB → 116 KB → 118 KB while the `rewrite` branch
    // sits over the historical floor; revisit and tighten once the client-floor extraction (TODO #3) lands.
    // 112→116 KB is ADR 0028's rpc run deadline (+2.5 KB here: `withDeadline`/`withAbort`/`isTimeoutError` and
    // the stream idle watchdog reach the client because the memo and the rpc proxy are isomorphic); 116→118 KB
    // is the pretty terminal log format — the browser uses `logChannelColor` for its console badge, but
    // `prettyLogLine`/`logFormat` are server-only bytes that ship because `log`'s side branch is a runtime
    // `isBrowser` check the bundler cannot fold (same class of waste as TODO #3, ~300 B minified). This bundle
    // is built with `dev: true`, so it is NOT minified and source comments count toward the number — a
    // production build strips them, which is why the bound tracks the heavy-item guard above rather than a
    // real shipping budget. 118→123 KB is isomorphic cache TAGS (~4 KB unminified, measured at 121.9 KB):
    // the tag registry's unregister, the memo's scope-owned teardown, `applyTagFrame`, `tagChannelName`,
    // and the `@tag:` channel join in the proxy + mux. Unlike the two entries above this is NOT waste — a
    // client-side `refresh/invalidate({ tags })` is the feature, so the registry and the join belong in the
    // browser. Some of the delta is comment bytes only this dev build counts; that split is not measured,
    // so do not read the number as shipped code. 123→128 KB is the isomorphic `identity()` (~3.8 KB
    // unminified, measured at 125.7 KB): the accessor, the tab's reactive ambient, and
    // the seed field's plumbing. Also NOT waste — a component reading `identity()` in the browser is the
    // feature, and the alternative (thread the principal down as a prop from every page) costs more
    // bytes in app code than it saves in framework code. That 125.7 KB reading ALSO carries a second,
    // concurrent addition the entry above does not name: the SWR refetch clock on the derivation path
    // (`memo(() => q(), { debounce })`, rpc-core §3) — the auto gate, its admit clock, and the gating
    // branch in `merged`, ~4.7 KB of unminified source measured by extracting the added regions, mostly
    // comment bytes only this dev build counts. So the 123→128 headroom is the two together, not
    // `identity()` alone; splitting them matters for whoever measures the next bump.
    // 128→134 KB is the hydration WIRE-FORMAT extraction (measured at 129.5 KB): the block anchor,
    // the `ab-p:`/`ab-l:` stream sentinels, the `__abide-app`/`__abide-seed` element ids and the seed
    // site-path grammar each became a named constant module instead of a literal repeated across
    // files — 5.2 KB of source, of which the CONSTANTS are a few dozen bytes and the rest is the
    // WHY comment on each. Also not waste, and the clearest case yet of what the note above warns
    // about: every one of those files minifies to almost nothing, and the same duplication they
    // removed is what silently corrupts hydration when a copy drifts. A smaller share is doc-comment
    // repair on `shared/{invalidate,refresh}.ts`, which had been describing tags as server-only ever
    // since they became isomorphic (~0.7 KB).
    //
    // 134→136 KB is `shared/internal/refetchClock.ts`: the throttle/debounce DECISION, which had been
    // written out twice inside `memo` — once for the pulled path (`scheduleRefresh`) and once for the
    // derivation path (`armAutoAdmit`) — and had already drifted in the arithmetic, one copy guarding
    // against a remainder its own caller made unreachable. 2.9 KB of source of which the decision is
    // about eight lines; the rest is the WHY, including why the two paths' STATE stays separate even
    // though their timing does not. Same shape as the entry above: it minifies to almost nothing, and
    // the duplication it removes is the kind that goes wrong silently.
    //
    // 136→137 KB is the hydration seed's crossRequest narrowing: `ReactiveScope.sharedReads` plus the
    // two blocks in `memo` that write and read it (420 bytes measured, 135,881 → 136,301, of which the
    // code is about ten lines). Both are structurally DEAD in a browser bundle — `crossRequest` is
    // `opts.crossRequest === true && !isBrowser`, so the client value is always `false` — but the
    // bundler cannot prove it, and the WHY is worth more here than the bytes: without the narrowing
    // `snapshot()` reported every crossRequest slot in the PROCESS, so a document shipped whatever a
    // background job had warmed and the seed grew with the shared cache instead of with the page.
    //
    // The ceiling is raised rather than the comments trimmed, deliberately: this bound is a
    // heavy-item tripwire (does a TypeScript compiler / a server-only subsystem reach the client?),
    // not a shipping budget — the assertions above are the real guard, and production is minified.
    // Squeezing under it by deleting the reasoning would trade the thing that has repeatedly caught
    // real bugs in this codebase for a number that measures nothing anyone ships.
    const bytes = Buffer.byteLength(body, 'utf8')
    expect(bytes).toBeLessThan(137_000)

    // Still a real bundle that boots the app and carries the AOT client mount runtime path.
    expect(body).toContain('bootstrapPage')
    expect(body).toContain('interpolate')

    await app.stop()
})

test("the SSR'd page injects the content-hashed client loader script tag", async () => {
    const app = await createTestApp({ pages: { '/': '<h1>ok</h1>' } })
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
        "<script>import { state } from 'abide/shared/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>"
    // PR7: bootstrapPage claims the SSR DOM. Render the real anchored server HTML into the container.
    const { render, hydrate } = await loadEmitted(source)
    const html = await render({ state: (v: unknown) => Object.assign(() => v, { set() {} }) })
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
