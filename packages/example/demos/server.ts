// The server substrate: a TemplateResult becomes HTML.
//
// One walk in document order, SYNCHRONOUS until the tree genuinely waits — a promise, an async
// iterable, or a consumer applying back-pressure. Reactivity is not involved: a render is a
// SNAPSHOT, so a thunk in a slot is simply called and no effects are created. Everything here also
// runs in the browser, because the module has no server-only dependencies — that is the point of the
// substrate split.

import { channel, html, memo, raw, state, type TemplateResult } from 'abide'
import { render, renderDocument, renderToString, shell, suspend, toStream } from 'abide/server'
import { container, floorTicks, keep, microtasks, settled, sleep, suite, tick } from 'abide/tests'
import { hydrate, mount } from 'abide/ui'
import { button, el, output, row } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

const slow = (ms: number, text: string): Promise<string> => sleep(ms).then(() => text)

const ROWS_1000 = vanilla.rows(1000)
const ROWS_200 = vanilla.rows(200)

export default suite({
    ...META.server,
    cases: [
        {
            title: 'renderToString — interleave and escape',
            note: 'Text in a child slot is escaped. `raw(...)` is the one way out of that.',
            async run({ is }) {
                const user = { name: '<b>ada</b>', tags: ['maths', 'engines'] }
                const markup = await renderToString(
                    html`<article><h2>${user.name}</h2><p>${raw('<em>on purpose</em>')}</p><ul>${user.tags.map(
                        (tag) => html`<li>${tag}</li>`,
                    )}</ul></article>`,
                )
                is(
                    'markup',
                    markup,
                    '<article><h2>&lt;b&gt;ada&lt;/b&gt;</h2><p><em>on purpose</em></p>' +
                        '<ul><li>maths</li><li>engines</li></ul></article>',
                )
            },
            interact({ host }) {
                const user = { name: '<b>ada</b>', tags: ['maths', 'engines'] }
                void renderToString(html`
                    <article>
                        <h2>${user.name}</h2>
                        <p>${raw('<em>rendered as markup, on purpose</em>')}</p>
                        <ul>
                            ${user.tags.map((tag) => html`<li>${tag}</li>`)}
                        </ul>
                    </article>
                `).then((markup) => output(host, markup.trim()))
            },
        },

        {
            title: 'attribute · event · property, on the server',
            note: 'An attribute omits on nullish/false and goes bare on true. An event slot emits nothing — there are no listeners in a string. A property slot emits nothing either: a DOM property has no serialisation, so use an attribute when the value must survive SSR.',
            async run({ is }) {
                const markup = await renderToString(
                    html`<button class=${'primary'} disabled=${true} title=${null} data-count=${0} @click=${() =>
                        undefined} .value=${'invisible to SSR'}>go</button>`,
                )
                is('markup', markup, '<button class="primary" disabled data-count="0">go</button>')
            },
            interact({ host }) {
                void renderToString(html`
                    <button
                        class=${'primary'}
                        disabled=${true}
                        title=${null}
                        data-count=${0}
                        @click=${() => undefined}
                        .value=${'invisible to SSR'}
                    >
                        go
                    </button>
                `).then((markup) => output(host, markup.trim()))
            },
        },

        {
            title: 'a thunk is CALLED, not subscribed to',
            note: 'Same authoring as the client, different action. Nothing here creates an effect, so nothing has to be disposed after the render.',
            async run({ is }) {
                const count = state(41)
                let calls = 0
                const next = (): number => {
                    calls++
                    return count() + 1
                }
                const view = (): TemplateResult =>
                    html`<p class=${() => (count() > 40 ? 'high' : 'low')}>${next}</p>`

                is('first render', await renderToString(view()), '<p class="high">42</p>')
                count.set(10)
                is('second render — a fresh snapshot', await renderToString(view()), '<p class="low">11</p>')
                is('one thunk call per render, no subscription', calls, 2)
            },
            bench: {
                kind: 'time',
                arms: [
                    {
                        // The shape a page is actually made of: a handful of slots, not a thousand
                        // rows. Nothing here is amortised over a list, so what shows up is the fixed
                        // cost of a render — the async wrapper and one slot scan.
                        label: 'abide — renderToString',
                        run: async (i: number) => {
                            keep(
                                await renderToString(
                                    html`<article class=${'card'}><h2>${`title ${i}`}</h2><p>${`body ${i}`}</p></article>`,
                                ),
                            )
                        },
                    },
                    {
                        label: 'vanilla — a template string',
                        run: (i: number) =>
                            keep(
                                `<article class="card"><h2>${vanilla.escapeHtml(`title ${i}`)}</h2>` +
                                    `<p>${vanilla.escapeHtml(`body ${i}`)}</p></article>`,
                            ),
                    },
                ],
            },
        },

        {
            title: 'render 1000 rows to a string',
            note: 'A render with nothing to wait for never touches a promise: the walk writes into a buffer and returns. It was an async generator, which reads better and hands back a promise for every chunk it already has — about seven microtask turns per row, and 74× the cost of a hand-written concat rather than the several× below. The next case is the number that made it visible.',
            async run({ is }) {
                const markup = await renderToString(
                    html`<table><tbody>${ROWS_1000.map(
                        (r) => html`<tr><td>${r.id}</td><td>${r.label}</td></tr>`,
                    )}</tbody></table>`,
                )
                // Byte-for-byte the same document as the hand-written concat — which is what makes
                // the timing comparison below a comparison rather than two different jobs.
                is('identical to the hand-written concat', markup, vanilla.tableToString(ROWS_1000))
            },
            bench: {
                kind: 'time',
                per: { n: 1000, label: 'row' },
                arms: [
                    {
                        label: 'abide — renderToString',
                        run: async () => {
                            keep(
                                await renderToString(
                                    html`<table><tbody>${ROWS_1000.map(
                                        (r) => html`<tr><td>${r.id}</td><td>${r.label}</td></tr>`,
                                    )}</tbody></table>`,
                                ),
                            )
                        },
                    },
                    {
                        label: 'vanilla — string concat',
                        run: () => keep(vanilla.tableToString(ROWS_1000)),
                    },
                    {
                        label: 'vanilla — array join',
                        run: () => keep(vanilla.tableToStringJoin(ROWS_1000)),
                    },
                ],
            },
        },

        {
            title: 'the microtask budget of a render',
            note: 'One of the three numbers this project budgets emitted code in, and the one a clock cannot show: a walk that yields per chunk is correct, is fast enough on a small page, and costs a microtask turn per chunk — which at a thousand rows is thousands of turns to hand over a string it already had in a buffer. A render with nothing to await should cost NONE of them, and this is where that stops being an intention.',
            async run({ is }) {
                const floor = await floorTicks()
                const turns = await microtasks(() =>
                    renderToString(
                        html`<table><tbody>${ROWS_200.map(
                            (r) => html`<tr><td>${r.id}</td><td>${r.label}</td></tr>`,
                        )}</tbody></table>`,
                    ),
                )
                // Not zero, because `renderToString` is an async function and awaiting it is itself a
                // turn. What must not happen is a turn PER ROW.
                is('200 rows cost fewer turns than there are rows', turns - floor < 200, true)
            },
            bench: {
                kind: 'budget',
                arms: [
                    {
                        label: 'abide — renderToString, 200 rows',
                        async run() {
                            const floor = await floorTicks()
                            const turns = await microtasks(() =>
                                renderToString(
                                    html`<table><tbody>${ROWS_200.map(
                                        (r) => html`<tr><td>${r.id}</td><td>${r.label}</td></tr>`,
                                    )}</tbody></table>`,
                                ),
                            )
                            return { count: Math.max(0, turns - floor), of: 'microtask turns for 200 rows' }
                        },
                    },
                    {
                        label: 'abide — render(), the streaming face, same rows',
                        async run() {
                            const floor = await floorTicks()
                            const turns = await microtasks(async () => {
                                let out = ''
                                for await (const chunk of render(
                                    html`<table><tbody>${ROWS_200.map(
                                        (r) => html`<tr><td>${r.id}</td><td>${r.label}</td></tr>`,
                                    )}</tbody></table>`,
                                )) {
                                    out += chunk
                                }
                                return out
                            })
                            return { count: Math.max(0, turns - floor), of: 'microtask turns for 200 rows' }
                        },
                    },
                    {
                        label: 'vanilla — string concat, no awaiting at all',
                        async run() {
                            const floor = await floorTicks()
                            const turns = await microtasks(async () => vanilla.tableToString(ROWS_200))
                            return { count: Math.max(0, turns - floor), of: 'microtask turns for 200 rows' }
                        },
                    },
                ],
            },
        },

        {
            title: 'the markers a hydratable render adds, and what they cost',
            note: 'What production actually serves. Two comments per CHILD slot — an attribute slot needs none, because the prepared template and the live document agree on its element positionally. The markers are markup, so the cost is bytes and concatenation rather than a different walk.',
            async run({ is }) {
                const view = (): TemplateResult =>
                    html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`
                const plain = await renderToString(view())
                const hydratable = await renderToString(view(), { hydratable: true })
                is(
                    'the same document, once the markers are stripped',
                    hydratable.replace(/<!--(\[|\$\d+)-->/g, ''),
                    plain,
                )
                // One pair per child slot: the list slot, plus one per row.
                is('one marker pair per child slot', (hydratable.match(/<!--\[-->/g) ?? []).length, 201)
            },
            bench: {
                kind: 'time',
                per: { n: 200, label: 'row' },
                arms: [
                    {
                        label: 'abide — renderToString({ hydratable: true })',
                        run: async () => {
                            keep(
                                await renderToString(
                                    html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`,
                                    { hydratable: true },
                                ),
                            )
                        },
                    },
                    {
                        label: 'abide — the same render, plain',
                        run: async () => {
                            keep(
                                await renderToString(
                                    html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`,
                                ),
                            )
                        },
                    },
                    {
                        label: 'vanilla — concat, no markers to write',
                        run: () => keep(vanilla.rowsToString(ROWS_200)),
                    },
                ],
            },
        },

        {
            title: 'promises are awaited in place; an async iterable streams',
            note: 'An async iterable in a child slot is server-only — the client handles a promise but not a stream; use a `channel` for that.',
            async run({ is }) {
                async function* lines(): AsyncGenerator<TemplateResult> {
                    for (const text of ['first', 'second', 'third']) yield html`<li>${text}</li>`
                }
                const markup = await renderToString(
                    html`<div><p>${Promise.resolve('awaited in place')}</p><ul>${lines()}</ul></div>`,
                )
                is(
                    'markup',
                    markup,
                    '<div><p>awaited in place</p><ul><li>first</li><li>second</li><li>third</li></ul></div>',
                )
            },
            interact({ host }) {
                async function* lines(): AsyncGenerator<TemplateResult> {
                    for (const text of ['first', 'second', 'third']) {
                        await sleep(60)
                        yield html`<li>${text}</li>`
                    }
                }
                void renderToString(html`
                    <div>
                        <p>${sleep(50).then(() => 'awaited in place')}</p>
                        <ul>${lines()}</ul>
                    </div>
                `).then((markup) => output(host, markup.trim()))
            },
        },

        {
            title: 'render() is a generator — it streams in document order',
            note: 'A chunk boundary is a SUSPENSION, not a string segment: everything written so far goes out before the walk waits, so a slot that has to wait holds the walk and the shell is already gone. That is the whole of the back-pressure, and it is why the walk itself can be synchronous — `renderToString` has nobody to hand anything to and pays no promises at all.',
            async run({ is }) {
                const chunks: string[] = []
                for await (const chunk of render(
                    html`<section><h3>${slow(0, 'shell')}</h3><p>${slow(30, 'the middle')}</p><p>${slow(
                        60,
                        'the tail',
                    )}</p></section>`,
                )) {
                    chunks.push(chunk)
                }
                const joined = chunks.join('')
                is('the shell came first', joined.indexOf('shell') < joined.indexOf('the middle'), true)
                is('…and the tail last', joined.indexOf('the middle') < joined.indexOf('the tail'), true)
                is(
                    'the whole document',
                    joined,
                    '<section><h3>shell</h3><p>the middle</p><p>the tail</p></section>',
                )
            },
            interact({ host, log }) {
                const started = performance.now()
                const pane = output(host)
                void (async () => {
                    for await (const chunk of render(html`
                        <section>
                            <h3>${slow(0, 'shell')}</h3>
                            <p>${slow(150, 'the middle, 150ms in')}</p>
                            <p>${slow(300, 'the tail, 300ms in')}</p>
                        </section>
                    `)) {
                        const trimmed = chunk.trim()
                        if (trimmed === '') continue
                        pane.textContent += `[+${String(Math.round(performance.now() - started)).padStart(4)}ms] ${trimmed}\n`
                    }
                    log('total', `${Math.round(performance.now() - started)}ms`)
                })()
            },
        },

        {
            title: 'toStream — the same walk as a ReadableStream',
            note: 'What you hand to a `Response`. The walk fills a buffer and hands it over when it passes the high-water mark or is about to wait — so back-pressure is per BUFFER rather than per string segment, and a fully synchronous page is not chopped into thousands of chunks it has to pay a microtask each to deliver.',
            async run({ is }) {
                const stream = toStream(html`<p>${Promise.resolve('from a ReadableStream')}</p>`)
                is(
                    'Response(stream).text()',
                    await new Response(stream).text(),
                    '<p>from a ReadableStream</p>',
                )
            },
            bench: {
                kind: 'time',
                per: { n: 200, label: 'row' },
                arms: [
                    {
                        label: 'abide — toStream + Response.text()',
                        run: async () => {
                            const stream = toStream(
                                html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`,
                            )
                            keep(await new Response(stream).text())
                        },
                    },
                    {
                        label: 'abide — renderToString',
                        run: async () => {
                            keep(
                                await renderToString(
                                    html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`,
                                ),
                            )
                        },
                    },
                    {
                        label: 'vanilla — concat, no stream',
                        run: () => {
                            let out = '<ul>'
                            for (const item of ROWS_200) out += `<li>${vanilla.escapeHtml(item.label)}</li>`
                            keep(`${out}</ul>`)
                        },
                    },
                ],
            },
        },

        {
            title: 'streams in document order, as a whole document',
            note: '`renderDocument` emits the shell, then the body in order. What comes back is a real document — doctype first, `</body></html>` last.',
            async run({ is }) {
                const chunks: string[] = []
                for await (const chunk of renderDocument('<title>t</title>', () => html`<p>a</p><p>b</p>`)) {
                    chunks.push(chunk)
                }
                const joined = chunks.join('')
                is('in order', joined.indexOf('<p>a</p>') < joined.indexOf('<p>b</p>'), true)
                is('starts with the doctype', joined.startsWith('<!doctype html>'), true)
                // A `lang` and a charset, because a document without them is wrong in the way a
                // browser papers over — it guesses the encoding, and the guess holds until the first
                // non-ASCII byte. The same opening an app with no `app.html` is served in, so there
                // is one answer to what abide's own document is.
                is(
                    'with a lang and a charset',
                    joined.includes('<html lang="en"><head><meta charset="utf-8">'),
                    true,
                )
                is('and closes the document', joined.endsWith('</body></html>'), true)
            },
        },

        {
            title: 'a page is served in the APP’s document, not abide’s',
            note: '`shell(html)` cuts an app’s own `app.html` at the `<slot></slot>` where a page goes, and `renderDocument` takes that instead of a `<head>` string. So the document is an ordinary html file — its `lang`, its meta tags, its analytics snippet — and abide adds two things to it: the scoped styles at the end of the head, and the page inside the slot. `abide start` reads the file; this is the same function it hands the text to.',
            async run({ is }) {
                const written =
                    '<!doctype html><html lang="en"><head><title>mine</title></head>' +
                    '<body><header>chrome</header><slot>loading…</slot></body></html>'

                const out: string[] = []
                for await (const chunk of renderDocument(shell(written), () => html`<p>the page</p>`)) {
                    out.push(chunk)
                }
                const joined = out.join('')

                is('the app’s own document', joined.startsWith('<!doctype html><html lang="en">'), true)
                is('its head, and its chrome', joined.includes('<header>chrome</header>'), true)
                is('the page renders inside the slot', joined.includes('<slot><p>the page</p></slot>'), true)
                // The tags stay and the placeholder goes: what a hydrating client adopts is the slot,
                // and what a person opening the file sees is the placeholder.
                is('the placeholder is replaced', joined.includes('loading…'), false)
                is('and nothing is left after it', joined.endsWith('</body></html>'), true)
                // The patch script rides out with the FIRST patch rather than in the shell, so a page
                // that suspends nothing ships neither it nor a `<script>` node inside the slot — where
                // an element the hydrating client did not render is a mismatch and a rebuilt subtree.
                is('a page that suspends nothing ships no script', joined.includes('<script'), false)

                // A document that EXPLAINS its own slot in a comment is the first document anybody
                // writes. Acting on the sentence renders the page inside the paragraph describing
                // where pages render.
                const documented = shell(
                    '<html><head></head><body><!-- <slot></slot> is where a page goes --><main><slot></slot></main></body></html>',
                )
                is('a comment about the slot is not the slot', documented.open.includes('<main>'), true)

                // No hole is a refusal rather than a guess: appending to `<body>` would be abide
                // deciding where somebody else’s document puts its content.
                let refused = ''
                try {
                    shell('<html><body><main></main></body></html>')
                } catch (failure) {
                    refused = (failure as Error).message
                }
                is('a shell with nowhere to render is refused', refused.includes('<slot></slot>'), true)
            },
        },

        {
            title: 'suspend — how a load reaches a snapshot',
            note: 'Every cell is thenable, so `suspend(cell, …)` takes one directly. Rendered to a plain string there is no document to patch, so it is awaited INLINE and the fallback never appears.',
            async run({ is, rejects }) {
                const session = state(sleep(10).then(() => ({ name: 'ada' })))
                const markup = await renderToString(
                    html`<p>${suspend(session, (user) => html`hello ${user?.name}`, 'loading…')}</p>`,
                )
                is('the value, not the fallback', markup, '<p>hello ada</p>')
                is('the fallback never appeared', markup.includes('loading'), false)

                // Inline, there is nowhere to put a failure but the caller.
                const failing = memo(async () => {
                    throw new Error('the load failed')
                })
                await rejects(
                    'a failing load, suspended inline',
                    renderToString(html`<p>${suspend(failing, () => html`never`, '…')}</p>`),
                    'the load failed',
                )
            },
        },

        {
            title: 'a SETTLED operand is not suspended at all, on either side',
            note: '`suspend(value, …)` takes a plain value as well as a promise, and there is nothing to defer about one that is already in hand. The server used to spend the whole out-of-order apparatus on it — an id, a placeholder, a fallback, an extra drain turn and a patch — to arrive at markup it could have written straight out; and because the client renders the body IN PLACE for a settled operand, that placeholder was markup no hydration ever expected to adopt. The client half had the matching gap: every re-run of the enclosing effect tore the settled panel down and rebuilt it, which `{#await}` in the same slot has never done.',
            async run({ is }) {
                // A document render, which is the lane that HAS somewhere to defer to. Rendered to a
                // plain string there is nowhere, so that lane could never have shown this.
                let written = ''
                for await (const chunk of renderDocument('<title>t</title>', () =>
                    html`<p>${suspend('already here', (t) => html`<b>${t}</b>`, 'loading…')}</p>`,
                )) {
                    written += chunk
                }
                is('the body is written in place', written.includes('<b>already here</b>'), true)
                // The three tells of the deferred path, none of which should be here.
                // Written down rather than imported: `$shared/internal/MARKERS.ts` owns it and an app
                // is not entitled to reach in there. Safe in the direction that matters — the markup
                // comes from `renderDocument`, so a renamed tag makes this assertion vacuous rather
                // than wrong, and the `<b>` assertion above is what would then fail.
                is('no placeholder was emitted', written.includes('<slot-s'), false)
                is('no patch script was emitted', written.includes('$p('), false)
                is('the fallback never appeared', written.includes('loading'), false)

                // The client half. A correctness test cannot see this one — the panel holds the
                // right markup either way — so what is counted is how many times the BODY ran.
                let bodies = 0
                const unrelated = state(0)
                const settled = { name: 'ada' }
                const host = container()
                const view = mount(host, () =>
                    html`<p>
                        ${() => unrelated()}
                        ${suspend(
                            settled,
                            (user: { name: string }) => {
                                bodies++
                                return html`<b>${user.name}</b>`
                            },
                            'loading…',
                        )}
                    </p>`,
                )
                try {
                    is('the body ran once', bodies, 1)
                    // A write to something else the same slot thunk reads. The operand did not move,
                    // so the settled panel has no business being rebuilt for it.
                    unrelated.set(1)
                    await tick()
                    is('an unrelated re-run does not restart it', bodies, 1)
                    is('and the panel still holds its value', host.textContent?.includes('ada'), true)
                } finally {
                    view.dispose()
                    host.remove()
                }
            },
        },

        {
            title: 'suspend is ISOMORPHIC — one marker, three continuations',
            note: 'The same block a server defers is one the client understands: it shows the fallback and swaps when the promise lands, which is what it already does for a promise in a slot. It has to be — a PAGE is the same module on both sides, so a marker only the server knew would render `[object Object]` in the browser and lock every page out of the primitive. Hydration then ADOPTS, because whatever the server sent is already the settled body.',
            async run({ is }) {
                const view = (): TemplateResult =>
                    html`<p>${suspend(
                        sleep(5).then(() => 'ada'),
                        (who) => html`hello ${who}`,
                        'loading…',
                    )}</p>`

                // The client half: the fallback is on screen first, which is the whole reason an
                // author wrote one. A server render never shows it — there is nothing to wake later.
                const mounted = container()
                mount(mounted, view)
                is('the fallback, while it waits', mounted.textContent, 'loading…')
                // The load is a real timer, so the graph flush alone would race it — `settled` drains
                // the effects, not the clock.
                await sleep(20)
                await settled()
                is('then the body', mounted.textContent, 'hello ada')

                // And the hydration half. The parse belongs to the template cache rather than to
                // adoption, so the call site is warmed before the markup is measured against it.
                const warm = document.createElement('div')
                mount(warm, view).dispose()
                const host = container()
                host.innerHTML = await renderToString(view(), { hydratable: true })
                is('the server settled it inline', host.textContent, 'hello ada')

                const paragraph = host.querySelector('p')
                hydrate(host, view)
                await settled()
                // The claim is about WORK: a client that re-ran the promise would flash the fallback
                // back up over markup that was already right, and rebuild the subtree to do it.
                is('the element is the one the parser made', host.querySelector('p'), paragraph)
                is('and it never flashed back to the fallback', host.textContent, 'hello ada')
                mounted.remove()
                host.remove()
            },
        },

        {
            title: 'renderDocument — a shell now, patches as they resolve',
            note: 'The placeholder is emitted in document order; the real subtree arrives later as a <template> plus a two-line script that swaps it in. Nothing ambient correlates the two — the walker hands out the id when it reaches the marker. Inside a document a failing subtree becomes an HTML comment, so the rest of the page survives.',
            async run({ is }) {
                const out: string[] = []
                for await (const chunk of renderDocument(
                    '',
                    () => html`
                        <main>
                            ${suspend(slow(40, 'SLOW'), (v) => html`<b>${v}</b>`, 'loading slow')}
                            ${suspend(slow(5, 'FAST'), (v) => html`<i>${v}</i>`, 'loading fast')}
                        </main>
                    `,
                )) {
                    out.push(chunk)
                }
                const joined = out.join('')
                is(
                    'the placeholder is emitted first',
                    joined.includes('<slot-s id="s0">loading slow</slot-s>'),
                    true,
                )
                is(
                    '…before the patch that replaces it',
                    joined.indexOf('loading slow') < joined.indexOf('SLOW'),
                    true,
                )
                is(
                    'the patch carries the resolved body',
                    joined.includes('<template id="t0"><b>SLOW</b></template>'),
                    true,
                )
                // Out of order: the 5ms subtree patches before the 40ms one, though it is second.
                is('the faster subtree patched first', joined.indexOf('FAST') < joined.indexOf('SLOW'), true)
            },
            interact({ host, log }) {
                const pane = output(host)
                const started = performance.now()
                const body = (): TemplateResult => html`
                    <main>
                        <h1>shell</h1>
                        ${suspend(slow(400, 'the SLOW subtree'), (t) => html`<p>${t}</p>`, html`<p>loading slow…</p>`)}
                        ${suspend(slow(100, 'the FAST subtree'), (t) => html`<p>${t}</p>`, html`<p>loading fast…</p>`)}
                    </main>
                `
                void (async () => {
                    for await (const chunk of renderDocument('<title>abide</title>', body)) {
                        pane.textContent += `[+${String(Math.round(performance.now() - started)).padStart(4)}ms] ${chunk.trim()}\n`
                    }
                    log(
                        'note the order',
                        'the 100ms subtree patched before the 400ms one, though it is second',
                    )
                })()
            },
        },

        {
            title: '…and the same document, streamed into a live frame',
            note: 'Written chunk by chunk with `document.write`, so what you see is the browser painting the shell first and the patches landing out of order — exactly what a real response does.',
            interact({ host, log }) {
                const frame = el('iframe', 'w-full h-56 rounded-lg border border-slate-700 bg-white')
                host.append(frame)
                host.append(
                    row(
                        button('stream it', async () => {
                            const doc = frame.contentDocument
                            if (doc === null) return
                            doc.open()
                            const started = performance.now()
                            for await (const chunk of renderDocument(
                                // The iframe is its own document, so it carries its own stylesheet — the page's
                                // Tailwind is not in scope inside it, and these three classes are what stands in.
                                '<title>streamed</title><style>body{font:14px system-ui;padding:12px}.slow{color:#0a7}.fast{color:#07a}.waiting{color:#999}</style>',
                                () => html`
                                    <h3>shell — painted immediately</h3>
                                    ${suspend(
                                        slow(1200, 'the slow subtree, 1200ms'),
                                        (t) => html`<p class="slow">${t}</p>`,
                                        html`<p class="waiting">loading slow…</p>`,
                                    )}
                                    ${suspend(
                                        slow(400, 'the fast subtree, 400ms'),
                                        (t) => html`<p class="fast">${t}</p>`,
                                        html`<p class="waiting">loading fast…</p>`,
                                    )}
                                `,
                            )) {
                                doc.write(chunk)
                            }
                            doc.close()
                            log('done', `${Math.round(performance.now() - started)}ms`)
                        }),
                    ),
                )
            },
        },

        {
            title: 'a PENDING cell renders blank',
            note: 'The honest answer for a snapshot with nothing to wake later. Warming the slot the component will read — awaiting the same args the render will ask for — is the minimal stand-in for a real SSR data pass.',
            async run({ is }) {
                const search = memo(async ({ q }: { q: string }) =>
                    ['alpha', 'beta', 'gamma'].filter((w) => w.includes(q)),
                )
                const view = (): TemplateResult =>
                    html`<ul>${() => (search({ q: 'a' })() ?? []).map((word) => html`<li>${word}</li>`)}</ul>`

                is('cold', await renderToString(view()), '<ul></ul>')
                await search({ q: 'a' }) // the data pass
                is('warm', await renderToString(view()), '<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>')
            },
        },

        {
            title: 'a channel in a slot — hand it the ITERATOR, not the channel',
            note: 'A channel is callable, and a function in a slot is a thunk the server simply calls — so a bare `${feed}` renders its latest message, which on a cold channel is nothing. `${feed[Symbol.asyncIterator]()}` is the streaming spelling: an async iterable in a child slot is walked.',
            async run({ is }) {
                const cold = channel<TemplateResult>()
                is(
                    'bare ${feed} on a cold channel',
                    await renderToString(html`<ul>${cold}</ul>`),
                    '<ul></ul>',
                )
                cold.publish(html`<li>the latest message</li>`)
                is(
                    'bare ${feed} once one has arrived',
                    await renderToString(html`<ul>${cold}</ul>`),
                    '<ul><li>the latest message</li></ul>',
                )

                // The streaming spelling. A channel never ends on its own, so the consumer breaks out.
                const feed = channel<TemplateResult>()
                void (async () => {
                    for (const text of ['tick 1', 'tick 2']) {
                        await sleep(5)
                        feed.publish(html`<li>${text}</li>`)
                    }
                })()
                let streamed = ''
                for await (const chunk of render(html`<ul>${feed[Symbol.asyncIterator]()}</ul>`)) {
                    streamed += chunk
                    if (chunk.includes('tick 2')) break
                }
                is(
                    'the iterator streamed both',
                    streamed.includes('tick 1') && streamed.includes('tick 2'),
                    true,
                )
            },
            interact({ host }) {
                const feed = channel<TemplateResult>()
                void (async () => {
                    for (const text of ['tick 1', 'tick 2', 'tick 3']) {
                        await sleep(80)
                        feed.publish(html`<li>${text}</li>`)
                    }
                })()
                const pane = output(host)
                const started = performance.now()
                void (async () => {
                    for await (const chunk of render(html`<ul>${feed[Symbol.asyncIterator]()}</ul>`)) {
                        pane.textContent += `[+${String(Math.round(performance.now() - started)).padStart(4)}ms] ${chunk.trim()}\n`
                        if (chunk.includes('tick 3')) break // a channel never ends on its own
                    }
                    pane.textContent += '(broke out — a channel is an infinite stream)'
                })()
            },
        },
    ],
})
