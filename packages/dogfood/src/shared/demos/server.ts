// The server substrate: a TemplateResult becomes HTML.
//
// One walk in document order, SYNCHRONOUS until the tree genuinely waits — a promise, an async
// iterable, or a consumer applying back-pressure. Reactivity is not involved: a render is a
// SNAPSHOT, so a thunk in a slot is simply called and no effects are created. Everything here also
// runs in the browser, because the module has no server-only dependencies — that is the point of the
// substrate split.

import { channel, html, memo, raw, state, type TemplateResult } from 'abide'
import { awaited, boundary, streamed } from 'abide/runtime'
import { GET, json, jsonl, type Renderable, render, server } from 'abide/server'
import {
    register,
    renderDocument,
    renderDocumentToString,
    renderToString,
    serve,
    toStream,
} from 'abide/server/internal'
import { remote } from 'abide/runtime/transport'
import { heldStream, isServing, shell } from 'abide/server/internal'
import { container, loopback, scratch, sleep, suite } from 'harness'
import { floorTicks, keep, microtasks, settled, tick } from 'harness/measure'
import { hydrate, mount } from 'abide/ui'
import { button, el, output, row } from './dom.ts'
import Card from './fixtures/Card.abide'
import Deferring, { peakInFlight as peakDeferring, reset as resetDeferring } from './fixtures/Deferring.abide'
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
            title: '`Renderable` is what the walk writes, and an array of them is one too',
            note: 'The type the whole server surface is declared in terms of — every renderer takes one. Worth naming in a case rather than only inferring it, because it is a UNION and the walk is a switch over exactly its arms: what a plain value renders as is the half a hydrating client has to agree with, so nullish and BOTH booleans are nothing rather than their spelling. `false` printing as "false" is the bug this shape exists to prevent, and it is invisible until markup already went out.',
            async run({ is }) {
                // Declared as the union rather than inferred, so a member added to `Renderable` that
                // the walk cannot write is a type error here rather than an `[object Object]` later.
                const every: Renderable[] = [
                    'text',
                    0,
                    42,
                    10n,
                    true,
                    false,
                    null,
                    undefined,
                    raw('<i>raw</i>'),
                    html`<b>tpl</b>`,
                    () => 'thunk',
                    Promise.resolve('later'),
                    ['nested', 1],
                ]
                is(
                    'every arm, in order',
                    await renderToString(every),
                    'text04210<i>raw</i><b>tpl</b>thunklaternested1',
                )
                // `10n` writes `10`: a bigint is its digits, not its literal spelling, which is the
                // one arm where the source text and the markup differ by a character.
                is('a bigint drops the suffix', await renderToString(10n), '10')
                is(
                    'nullish and both booleans write nothing',
                    await renderToString([true, false, null, undefined]),
                    '',
                )
                is('…while zero and empty string are values', await renderToString([0, '']), '0')
            },
        },

        {
            title: '`server.peek` observes where `server()` insists',
            note: 'The same split every source in abide makes, on the one piece of process state: a READ is a demand — `server()` throws with the two ways to fix it, because code that needs the instance cannot carry on without one — and a PROBE only observes. That is what lets a library ask "am I inside a served process?" without either throwing or being the thing that decides. This case runs where the answer is genuinely nothing, which is the arm `server()` cannot be asked on at all and the reason the two are not one function with a flag.',
            run({ is }) {
                // `null`, not `undefined`, and not a throw: nothing has served in a demo card or
                // under `bun test`, and that is an answer rather than a failure to have one.
                is('null before anything served', server.peek(), null)
                is('and the demanding form refuses instead', isServing(), false)

                const pretend = { url: new URL('http://demo.invalid/') } as unknown as Parameters<
                    typeof server.set
                >[0]
                try {
                    is('set hands back what it was given', server.set(pretend) === pretend, true)
                    is('…and the probe now sees it', server.peek(), pretend)
                } finally {
                    // Put back, because this is PROCESS state and every case after this one shares
                    // it — a demo that left a fake server standing would be the reason a later case
                    // measured something else.
                    server.set(null as unknown as Parameters<typeof server.set>[0])
                }
                is('put back', server.peek(), null)
            },
        },

        {
            title: '`heldStream` — a body that outlives the handler still answers inside its scope',
            note: "A streaming response is built inside a request and CONSUMED after the handler returned, so the caller scope every ambient answers off has to be held open for as long as the body is pumping — otherwise a `memo` read on the third chunk answers from a different caller's cache, or from none. Abide holds what abide builds; this is the one piece an app reaches for directly, for a stream it made itself. IDEMPOTENT, so `page(toStream(view))` is one wrapper rather than two and an app may call it on anything it is about to answer with. Outside a request there is nothing to hold and the body is handed straight back — which is what this case is in a position to assert, since a demo runs in a browser card as readily as under `bun test`.",
            run({ is }) {
                is('nothing to hold out here', isServing(), false)

                const body = toStream(html`<p>ok</p>`)
                is('so the body is handed straight back', heldStream(body) === body, true)

                // The idempotence is the claim that lets an app wrap without checking: a second call
                // returns the first one's result rather than pumping a pump.
                const once = heldStream(body)
                is('and wrapping twice is wrapping once', heldStream(once) === once, true)
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

                // An attribute slot WAITS on a pending read, exactly as a child slot does — and the
                // asymmetry that fixes is invisible from either side alone: the client binds the
                // class once the load lands, so a server that let the read serve `undefined` dropped
                // an attribute the client then had. Nothing compares the two, and the markup is
                // simply wrong for a reader running no scripts.
                const tone = state(Promise.resolve('high'))
                is(
                    'an attribute reading a cold state',
                    await renderToString(html`<p class=${() => tone()}>x</p>`),
                    '<p class="high">x</p>',
                )

                // …and a spread, which is the same unwrap with more than one attribute behind it.
                const attrs = state(Promise.resolve({ id: 'a', lang: 'en' }))
                is(
                    'a spread reading a cold state',
                    await renderToString(html`<p ...=${() => attrs()}>x</p>`),
                    '<p id="a" lang="en">x</p>',
                )
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
                // The floor is `renderToString` being an async function — awaiting it is itself a
                // turn — so what is left after subtracting it is what the WALK owed, and the walk
                // owes none. Pinned at 0 rather than bounded below the row count: a bound of 200
                // over 200 rows still passes a walk that yields every other row, which is the same
                // O(n) shape the case exists to forbid.
                is('the walk over 200 rows owes no turns of its own', turns - floor, 0)
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
                const hydratable = await renderToString(view(), { hydrate: true })
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
                        label: 'abide — renderToString({ hydrate: true })',
                        run: async () => {
                            keep(
                                await renderToString(
                                    html`<ul>${ROWS_200.map((r) => html`<li>${r.label}</li>`)}</ul>`,
                                    { hydrate: true },
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
            title: 'a slow source delivers a chunk PER ROW, not a buffer-full',
            note: 'The back-pressure and the chunk boundary are two different questions, and answering them with one mechanism breaks streaming. A row that arrived slowly is a suspension and must go out; a row that arrived instantly need only go out once the buffer is worth handing over. Gating a streamed row on the buffer mark instead — the obvious way to make this loop cheaper — was measured at 2.47x and collapsed twenty-two chunks into two, which is the whole feature. The count is the assertion because the joined output is identical either way: a reader who waited for the last row would see exactly the same page.',
            async run({ is }) {
                async function* trickle(n: number): AsyncGenerator<number> {
                    for (let index = 0; index < n; index++) {
                        await sleep(1)
                        yield index
                    }
                }
                const chunks: string[] = []
                for await (const chunk of render(
                    html`<ul>${streamed(trickle(8), (index: number) => html`<li>row ${index}</li>`)}</ul>`,
                )) {
                    chunks.push(chunk)
                }
                // Eight rows, each its own chunk, plus the shell before them and the close after.
                is('a chunk per row', chunks.length, 10)
                is('and the page is whole', chunks.join('').match(/<li>/g)?.length, 8)
                // The back-pressure is still real: nothing is buffered past the walk's own mark, so
                // this is a claim about WHEN bytes leave, not about how many there are.
                is('…in order', chunks.join('').indexOf('row 0') < chunks.join('').indexOf('row 7'), true)
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
            title: '`render(view, { shell })` — a document from the one public renderer',
            note: 'The two decisions a render is asked for, and both default to OFF: `shell` is the document around the markup and `hydrate` is whether a client takes it over. `shell: true` is the APP’s own `app.html` — the same document `abide start` serves a page in, with the build’s stylesheets and every scoped `<style>` block in the head — and a STRING is one of the caller’s own, which is a whole html file with a `<slot></slot>` in it rather than a fragment or a head. That last part is why a route no longer writes a doctype by hand around `render(view)`: a scoped `<style>` is written by the DOCUMENT, so the hand-written form shipped the markup and none of the rules. The document faces themselves stay on `abide/server/internal` — an app reaches one through this option, so there is one name to learn.',
            async run({ is }) {
                const answer = 'the answer'
                // A child slot, because that is what a marker brackets — the `hydrate` claim below is
                // about markup a client can adopt, and a template with no slot in it has none.
                const view = (): TemplateResult => html`<p>${answer}</p>`
                const written =
                    '<!doctype html><html lang="en"><head><title>mine</title></head>' +
                    '<body><header>chrome</header><slot>loading…</slot></body></html>'

                let bare = ''
                for await (const chunk of render(view())) bare += chunk
                is('markup, when nothing was asked for', bare, '<p>the answer</p>')

                let own = ''
                for await (const chunk of render(view(), { shell: written })) own += chunk
                is('the caller’s own document', own.startsWith('<!doctype html><html lang="en">'), true)
                is('its own chrome, above the render', own.includes('<header>chrome</header>'), true)
                is('the render lands in the slot', own.includes('<slot><p>the answer</p></slot>'), true)
                is('the placeholder is replaced', own.includes('loading…'), false)
                is('and the document closes', own.endsWith('</body></html>'), true)

                // The reason the option exists rather than a hand-written doctype: a `.abide` file's
                // `<style>` block is written into the HEAD, which a route concatenating its own
                // document around `render(view)` has no way to do.
                let styled = ''
                for await (const chunk of render(Card(), { shell: written })) styled += chunk
                is(
                    'a component’s scoped rules ride in the head',
                    styled.indexOf('<style data-abide=') < styled.indexOf('</head>'),
                    true,
                )
                is('…and the markup carries the scope they are keyed by', styled.includes('data-a'), true)

                // `shell: true` is the app's own document, and the app HERE is nobody: this process
                // booted nothing, so what comes back is the document an app that wrote no `app.html`
                // is served in. A real app's own document is a boot fact and therefore a browser
                // claim — `docs.e2e.ts` makes it against a served route.
                let abides = ''
                for await (const chunk of render(view(), { shell: true })) abides += chunk
                is(
                    'abide’s own document, when nothing published one',
                    abides.includes('<meta name="viewport"'),
                    true,
                )
                is('with the render in its slot', abides.includes('<slot><p>the answer</p></slot>'), true)

                // The second decision, independent of the first.
                is('no markers unless a client is going to adopt', own.includes('<!--[-->'), false)
                let live = ''
                for await (const chunk of render(view(), { shell: written, hydrate: true })) live += chunk
                is('markers when one is', live.includes('<!--[-->'), true)
                // The lane is the BUILD's — the generated entry, named in the manifest — so a render
                // in a process that never built one has none to write, and that is the same reason
                // `hydrate` cannot be the default: the client mounts the pages route table at the
                // outlet, which on a path no page owns replaces what the route just served.
                is(
                    'and nothing to boot, because nothing was built',
                    live.includes('<script type="module"'),
                    false,
                )

                // Refused where the response has not started, rather than on the first chunk: the
                // shell is resolved by the call, so a document with nowhere to render never serves a
                // byte.
                let refused = ''
                try {
                    render(view(), { shell: '<html><body><main></main></body></html>' })
                } catch (failure) {
                    refused = (failure as Error).message
                }
                is('a shell with nowhere to render is refused', refused.includes('<slot></slot>'), true)
            },
        },

        {
            title: 'a document for a reader that runs nothing',
            note: '`renderDocumentToString(body)` is the same shell around `renderToString`’s walk, and the difference is where a `suspend` lands. A streamed document defers it into a `<template>` and a two-line script that puts it back; an email client runs no script, so that subtree would sit in the template forever. Rendering to a string there is nowhere to patch, so the load is awaited in place and the markup is complete when the string is. The head trails and defaults to nothing — abide’s own document is the whole of what a mail needs around it — and the body is a NODE rather than a thunk, because a plain async function has nothing to delay.',
            async run({ is }) {
                const body = () =>
                    html`<h1>receipt</h1>
                        <p>${awaited(slow(5, '$12'), { pending: () => 'loading…', then: (total) => html`<b>${total}</b>`, catch: undefined, finally: undefined })}</p>`

                const mailed = await renderDocumentToString(body())
                is('the load is written in place', mailed.includes('<b>$12</b>'), true)
                is('so the fallback never appears', mailed.includes('loading…'), false)
                is('and there is nothing to run', mailed.includes('<script'), false)
                // No head asked for, so what is around it is abide's own document — the doctype, the
                // lang and the charset — followed by whatever scoped styles are registered, which is
                // the one thing that reaches a head nobody wrote.
                is(
                    'abide’s own document around it',
                    mailed.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8">'),
                    true,
                )
                is('and no head of its own', mailed.includes('<title'), false)
                is('closed', mailed.endsWith('</body></html>'), true)

                // A thunk is an arm of `Renderable`, so the wrapper a streamed render needs is still
                // accepted here rather than being a second spelling to remember.
                const titled = await renderDocumentToString(body, '<title>receipt</title>')
                is('a head, when there is one to give', titled.includes('<title>receipt</title>'), true)
                is('and a thunk renders the same', titled.includes('<b>$12</b>'), true)

                // The same body through the streamed lane, which is what the string lane exists
                // beside: the subtree is markup a script has to move, and nothing moves it here.
                let streamed = ''
                for await (const chunk of renderDocument('<title>receipt</title>', body)) streamed += chunk
                is('streamed, it arrives as a patch', streamed.includes('<template id='), true)
                is('that only a script applies', streamed.includes('<script'), true)
            },
        },

        {
            title: 'suspend — how a load reaches a snapshot',
            note: 'Every state is thenable, so `awaited(state, { pending: () => null, then: …, catch: undefined, finally: undefined })` takes one directly. Rendered to a plain string there is no document to patch, so it is awaited INLINE and the fallback never appears.',
            async run({ is, rejects }) {
                const session = state(sleep(10).then(() => ({ name: 'ada' })))
                const markup = await renderToString(
                    html`<p>${awaited(session, { pending: () => 'loading…', then: (user) => html`hello ${user?.name}`, catch: undefined, finally: undefined })}</p>`,
                )
                is('the value, not the fallback', markup, '<p>hello ada</p>')
                is('the fallback never appeared', markup.includes('loading'), false)

                // Inline, there is nowhere to put a failure but the caller.
                const failing = memo(async () => {
                    throw new Error('the load failed')
                })
                await rejects(
                    'a failing load, suspended inline',
                    renderToString(
                        html`<p>${awaited(failing, { pending: () => '…', then: () => html`never`, catch: undefined, finally: undefined })}</p>`,
                    ),
                    'the load failed',
                )
            },
        },

        {
            title: 'an ARM is a body, so a read inside one waits too',
            note: 'Every arm a deferring block carries, and the failure arm of a `{#for await}`, are bodies the walk runs rather than values handed to it — so a cold read in one signals to the walk exactly as a slot thunk’s does. Easy to believe already works and easy to test as if it did: with a load that settles in a microtask the arm reads it warm and the case passes for the wrong reason, so every read here is behind a real delay.',
            async run({ is }) {
                const late = (): (() => string | undefined) => state(slow(30, '!'))

                const inThen = late()
                is(
                    'the settled arm',
                    await renderToString(
                        html`<p>${() => awaited(slow(5, 'x'), { pending: undefined, then: (v: string) => html`${v}${inThen()}`, catch: undefined, finally: undefined })}</p>`,
                    ),
                    '<p>x!</p>',
                )

                const inCatch = late()
                is(
                    'the failure arm',
                    await renderToString(
                        html`<p>${() => awaited(Promise.reject(new Error('down')), { pending: undefined, then: undefined, catch: () => html`failed${inCatch()}`, finally: undefined })}</p>`,
                    ),
                    '<p>failed!</p>',
                )

                const inFinally = late()
                is(
                    'the finally arm of a {#try}',
                    await renderToString(
                        html`<p>${() => awaited(slow(5, 'x'), { pending: undefined, then: (v: string) => v, catch: undefined, finally: () => html`<i>${inFinally()}</i>` })}</p>`,
                    ),
                    '<p>x<i>!</i></p>',
                )

                // A SETTLED operand takes the arm without ever awaiting, which is a different line
                // through the walk and had the same hole in it.
                const inSettled = late()
                is(
                    'an operand already in hand',
                    await renderToString(
                        html`<p>${() => awaited('x', { pending: undefined, then: (v: string) => html`${v}${inSettled()}`, catch: undefined, finally: undefined })}</p>`,
                    ),
                    '<p>x!</p>',
                )

                const inFailure = late()
                const boom = (async function* () {
                    yield 'a'
                    throw new Error('down')
                })()
                is(
                    'a {#for await} failure arm',
                    await renderToString(
                        html`<ul>${() =>
                            streamed(
                                boom,
                                (item: string) => html`<li>${item}</li>`,
                                () => html`<b>failed${inFailure()}</b>`,
                            )}</ul>`,
                    ),
                    '<ul><li>a</li><b>failed!</b></ul>',
                )
            },
        },

        {
            title: 'a SETTLED operand is not suspended at all, on either side',
            note: '`awaited(value, { pending: () => null, then: …, catch: undefined, finally: undefined })` takes a plain value as well as a promise, and there is nothing to defer about one that is already in hand. The server used to spend the whole out-of-order apparatus on it — an id, a placeholder, a fallback, an extra drain turn and a patch — to arrive at markup it could have written straight out; and because the client renders the body IN PLACE for a settled operand, that placeholder was markup no hydration ever expected to adopt. The client half had the matching gap: every re-run of the enclosing effect tore the settled panel down and rebuilt it, which a block in the same slot has never done.',
            async run({ is }) {
                // A document render, which is the lane that HAS somewhere to defer to. Rendered to a
                // plain string there is nowhere, so that lane could never have shown this.
                let written = ''
                for await (const chunk of renderDocument(
                    '<title>t</title>',
                    () =>
                        html`<p>${awaited('already here', { pending: () => 'loading…', then: (t) => html`<b>${t}</b>`, catch: undefined, finally: undefined })}</p>`,
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
                const view = mount(host, () => {
                    // Read in the body that builds the block, for the reason spelled out below.
                    unrelated()
                    return html`<p>
                        ${awaited(settled, {
                            pending: () => 'loading…',
                            then: (user: { name: string }) => {
                                bodies++
                                return html`<b>${user.name}</b>`
                            },
                            catch: undefined,
                            finally: undefined,
                        })}
                    </p>`
                })
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

                // The same claim for an operand that genuinely SUSPENDS, which is the arm that
                // settles through `settle` rather than painting in the call. It is the one that
                // matters and the easier one to leave half-fixed: the panel above never suspends, so
                // it exercises the path where `holding` was already being kept.
                let waited = 0
                const other = state(0)
                const landing = sleep(5).then(() => ({ name: 'grace' }))
                const into = container()
                const mounted = mount(into, () => {
                    // READ HERE, in the body that builds the block — not in a nested thunk. A thunk
                    // slot gets its own effect, so a state read inside one wakes that slot and leaves
                    // this function alone, and the re-run this case is about would never happen.
                    other()
                    return html`<p>
                        ${awaited(landing, {
                            pending: () => 'loading…',
                            then: (user: { name: string }) => {
                                waited++
                                return html`<b>${user.name}</b>`
                            },
                            catch: undefined,
                            finally: undefined,
                        })}
                    </p>`
                })
                try {
                    is('the fallback, while it waits', into.textContent?.includes('loading'), true)
                    await landing
                    await tick()
                    is('then the body, once', waited, 1)
                    // The operand has not moved — it is the same promise, now settled — so this must
                    // not throw the panel back to its fallback and rebuild it.
                    other.set(1)
                    await tick()
                    is('an unrelated re-run does not re-suspend it', waited, 1)
                    is('and the fallback did not come back', into.textContent?.includes('loading'), false)
                    is('the panel still holds its value', into.textContent?.includes('grace'), true)
                } finally {
                    mounted.dispose()
                    into.remove()
                }

                // And the ADOPTION twin. A hydrated panel is a settled one, so the same cutoff has to
                // hold for a range that came off the parser rather than out of a render — `set` and
                // `take` are two doors into the same block and the guard is worth nothing if only one
                // of them records what it is showing.
                let adopted = 0
                const shifting = state(0)
                const held = { name: 'hopper' }
                const hydrating = (): TemplateResult => {
                    shifting()
                    return html`<p>${awaited(held, {
                        pending: () => 'loading…',
                        then: (user: { name: string }) => {
                            adopted++
                            return html`<b>${user.name}</b>`
                        },
                        catch: undefined,
                        finally: undefined,
                    })}</p>`
                }
                const server = container()
                server.innerHTML = await renderToString(hydrating(), { hydrate: true })
                const element = server.querySelector('b')
                const live = hydrate(server, hydrating)
                try {
                    await tick()
                    is('the element is the one the parser made', server.querySelector('b'), element)
                    const afterAdopt = adopted
                    shifting.set(1)
                    await tick()
                    is('an unrelated re-run does not re-enter the body', adopted, afterAdopt)
                    is('and the element still is', server.querySelector('b'), element)
                } finally {
                    live.dispose()
                    server.remove()
                }
            },
        },

        {
            title: 'a THENABLE fallback does not race the body it stands in for',
            note: "The fallback is rendered through the ordinary slot path, and a state is thenable — so one handed over as a fallback starts a settle of its own. It used to be stamped with the same generation the suspend's own settle then took, which makes the two mutually exclusive: whichever landed first retired the other. The fallback is normally the settled one, so it won, and the body never ran at all.",
            async run({ is }) {
                // A state, which is the ordinary thing to reach for and is thenable by contract.
                const placeholder = state('waiting…')
                const landing = sleep(5).then(() => 'landed')
                const host = container()
                const view = mount(
                    host,
                    () =>
                        html`<p>${awaited(landing, { pending: () => placeholder, then: (t: string) => html`<b>${t}</b>`, catch: undefined, finally: undefined })}</p>`,
                )
                try {
                    await landing
                    await tick()
                    is('the body ran and is on screen', host.textContent?.includes('landed'), true)
                    is('the fallback did not outlive it', host.textContent?.includes('waiting'), false)
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
                    html`<p>${awaited(
                        sleep(5).then(() => 'ada'),
                        {
                            pending: () => 'loading…',
                            then: (who) => html`hello ${who}`,
                            catch: undefined,
                            finally: undefined,
                        },
                    )}</p>`

                // The client half: the fallback is on screen first, which is the whole reason an
                // author wrote one. A server render never shows it — there is nothing to wake later.
                const mounted = scratch(view)
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
                host.innerHTML = await renderToString(view(), { hydrate: true })
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
                            ${awaited(slow(40, 'SLOW'), { pending: () => 'loading slow', then: (v) => html`<b>${v}</b>`, catch: undefined, finally: undefined })}
                            ${awaited(slow(5, 'FAST'), { pending: () => 'loading fast', then: (v) => html`<i>${v}</i>`, catch: undefined, finally: undefined })}
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
                        ${awaited(slow(400, 'the SLOW subtree'), { pending: () => html`<p>loading slow…</p>`, then: (t) => html`<p>${t}</p>`, catch: undefined, finally: undefined })}
                        ${awaited(slow(100, 'the FAST subtree'), { pending: () => html`<p>loading fast…</p>`, then: (t) => html`<p>${t}</p>`, catch: undefined, finally: undefined })}
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
            title: 'the FORM decides whether a subtree is deferred',
            note: 'One rule, and the choice is which SPELLING you reach for rather than which call. A chain that ASKS about the load — `{#if x.pending()}…{:else}…{/if}` — has a pending arm, so a document render sends it as a placeholder and patches the settled arm in; the shell goes out immediately. Reading the state without asking first — `<p>{x}</p>` on its own — has nothing to send, so the walk blocks and the markup is complete when it arrives. Having something to show is the whole test, and asking about `.pending()` IS having something to show. The choice matters because a patch travels in a `<template>` behind a two-line script, so a deferred subtree needs JAVASCRIPT — a crawler, a mail client or `curl` sees the placeholder and nothing else. Blocking is how an author says the content must be IN the html.',
            async run({ is }) {
                // What a chain over the probes compiles to: an arm to send now, and the same arm
                // again as what to patch in.
                const withPending = (): TemplateResult =>
                    html`<p>shell</p>${awaited(slow(5, 'landed'), {
                        pending: () => html`<em>waiting</em>`,
                        then: (t) => html`<b>${t}</b>`,
                        catch: undefined,
                        finally: undefined,
                    })}`
                // …and what a bare read compiles to: no pending arm at all, so nothing to send.
                const without = (): TemplateResult =>
                    html`<p>shell</p>${awaited(slow(5, 'landed'), {
                        pending: undefined,
                        then: (t) => html`<b>${t}</b>`,
                        catch: undefined,
                        finally: undefined,
                    })}`

                // WHICH CHUNK each string arrives in, not which bytes exist at the end: both
                // documents contain the same text, and a render that awaited everything before
                // writing produces an identical one. Order is the whole claim.
                const at = (chunks: string[], text: string): number =>
                    chunks.findIndex((chunk) => chunk.includes(text))

                const deferred: string[] = []
                for await (const chunk of renderDocument('', withPending)) deferred.push(chunk)
                is(
                    'the pending arm is on the wire before the body',
                    at(deferred, 'waiting') < at(deferred, 'landed'),
                    true,
                )
                is(
                    '…and the body arrives behind a patch script',
                    at(deferred, 'landed') > at(deferred, 'window.$p'),
                    true,
                )

                const blocked: string[] = []
                for await (const chunk of renderDocument('', without)) blocked.push(chunk)
                is('no pending arm means no placeholder at all', blocked.join('').includes('<slot-s'), false)
                is('…and no patch script either', blocked.join('').includes('window.$p'), false)
                is('…and nothing in a template', blocked.join('').includes('<template'), false)
                // Which is the whole point: the body is ordinary markup in the document, so a reader
                // that runs nothing at all still has it. It is not in the SAME chunk as the shell —
                // the walk flushes what it has written before it waits, which is what makes the
                // blocking lane stream at all rather than buffer the whole page.
                is('…the body is in the document itself', blocked.join('').includes('<b>landed</b>'), true)
                is('…in document order, after the shell', at(blocked, 'landed') > at(blocked, 'shell'), true)
            },
        },

        {
            title: 'a probed STREAM patches its first chunk and hands the rest over',
            note: 'The one place `pending` and `settled` are different moments. A probe asks whether there is anything to SHOW, and a stream answers yes at its first chunk while its settle waits for the last — so a walk that took the settle held the page for the whole length of the stream. It held it for markup nobody keeps: a client mounting over a streamed region drops those rows and restarts from the top, because what is under them is a different point in the same stream and no later chunk makes it match. So the patch carries the first chunk and the client carries the rest. The lane with NOWHERE to patch is the exception and keeps draining — a reader running no scripts has only what the markup holds, and half a transcript is what it would keep forever.',
            async run({ is }) {
                async function* ticking(): AsyncGenerator<number> {
                    for (let n = 1; n <= 4; n++) {
                        await sleep(5)
                        yield n
                    }
                }
                // What `{#if ticks.pending()}` compiles to: a thunk that probes, and therefore has
                // something to show while the stream runs.
                const streaming = (): TemplateResult => {
                    const ticks = state(ticking())
                    return html`<p>shell</p>${() =>
                        ticks.pending()
                            ? html`<em>waiting</em>`
                            : html`<b>latest ${ticks()} of ${ticks.chunks().length}</b>`}`
                }

                let patched = ''
                for await (const chunk of renderDocument('', streaming)) patched += chunk
                is('the placeholder went out', patched.includes('<em>waiting</em>'), true)
                // THE COUNT is the claim, and it has to be the transcript's rather than the value's:
                // a walk that drained the stream and patched at the end renders `latest 4 of 4`, and
                // both documents are otherwise identical.
                is('…and the patch carries the FIRST chunk', patched.includes('latest 1 of 1'), true)
                is('…not the whole transcript', patched.includes('of 4'), false)

                // Nowhere to patch: the same body, drained, because this is the lane whose reader
                // runs no scripts. Asserted through `renderDocumentToString` rather than by reverting
                // the probe — the two lanes take different branches on the SAME spelling, which is
                // the distinction this case exists to hold.
                const mailed = await renderDocumentToString(streaming())
                is('a string render drains it instead', mailed.includes('latest 4 of 4'), true)
                is('…so it never shows the placeholder', mailed.includes('<em>waiting</em>'), false)
            },
        },

        {
            title: 'a deferred load that FAILS renders its failure arm',
            note: 'The gap the one-marker rewrite closed. `suspend(value, body, fallback)` had no error arm at all, so a deferred load that rejected wrote an HTML comment: the reader got a blank panel and was told nothing. A block has always carried a failure arm, and carrying it through the deferred path is most of why there is one marker now rather than two. With no `{:catch}` it is still a comment — the author did not say what to show — but it is reported on abide’s own channel rather than only to somebody viewing source, because by the time a deferred subtree fails the shell is already on the wire and there is nothing left to fail INTO.',
            async run({ is }) {
                // `renderDocument`, and that is load-bearing rather than incidental: a pending arm
                // only DEFERS where there is somewhere to patch, so asserting this through
                // `renderDocumentToString` would take the inline path and pass with the deferred
                // catch removed entirely. It did, until the revert said so.
                const body = (): TemplateResult =>
                    html`<p>shell</p>${awaited(
                        sleep(5).then(() => {
                            throw new Error('the load refused')
                        }),
                        {
                            pending: () => html`<em>waiting</em>`,
                            then: () => html`<b>never</b>`,
                            catch: (error: unknown) => html`<i>${String(error)}</i>`,
                            finally: undefined,
                        },
                    )}`
                let caught = ''
                for await (const chunk of renderDocument('', body)) caught += chunk
                is('the catch arm arrived as the patch', caught.includes('the load refused'), true)
                is('…and the then arm did not', caught.includes('never'), false)
                is('…and it is not a comment', caught.includes('<!-- await'), false)
            },
        },

        {
            title: '…and a failure arm that THROWS still ends the response',
            note: 'The compiled shape, and what it does on a rejected load. `{#if x.pending()}…{:else}…{/if}` hands the SAME chain to all three branches, so the failure arm is the chain: `pending()` is false by then, the chain falls to an arm that READS the state, and the read throws the failure it was called to report. `drain` waits for each subtree’s markup to settle and attaches nothing to a rejection, so before this the subtree was one it waited on forever — the response never ended, the placeholder stayed on screen, and a browser console had nothing in it because the failure was here. Every path out now returns markup: a comment, and a line on abide’s own channel.',
            async run({ is }) {
                // The emitted form, by hand — the chain, three times, over a state that rejects.
                const failing = state<{ name: string } | undefined>(
                    sleep(5).then((): { name: string } => {
                        throw new Error('the load refused')
                    }),
                )
                const chain = () =>
                    failing.pending() ? html`<em>waiting</em>` : html`<b>${() => failing()?.name}</b>`
                const arm = () => html`${chain}`
                const body = (): TemplateResult =>
                    html`<p>shell</p>${awaited(failing, {
                        pending: arm,
                        then: arm,
                        catch: arm,
                        finally: undefined,
                    })}`

                // The claim is TERMINATION, so the race is the assertion rather than a courtesy: with
                // the containment reverted this generator never returns, and a bare `for await` here
                // hangs the whole suite instead of failing it — which reports nothing at all.
                let caught = ''
                const drained = (async () => {
                    for await (const chunk of renderDocument('', body)) caught += chunk
                    return true
                })()
                const ended = await Promise.race([drained.catch(() => false), sleep(1000).then(() => false)])

                is('the response ended', ended, true)
                is(
                    'the placeholder went out first',
                    caught.includes('<slot-s id="s0"><em>waiting</em>'),
                    true,
                )
                is(
                    '…and the patch that replaced it is the comment',
                    caught.includes('<!-- await 0 failed'),
                    true,
                )
                is('…naming the failure', caught.includes('the load refused'), true)
            },
        },

        {
            title: '…and the same document, streamed into a live frame',
            note: 'Written chunk by chunk with `document.write`, so what you see is the browser painting the shell first and the patches landing out of order — exactly what a real response does.',
            interact({ host, log }) {
                const frame = el('iframe', 'w-full h-56 rounded-lg border border-rule bg-white')
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
                                    ${awaited(slow(1200, 'the slow subtree, 1200ms'), { pending: () => html`<p class="waiting">loading slow…</p>`, then: (t) => html`<p class="slow">${t}</p>`, catch: undefined, finally: undefined })}
                                    ${awaited(slow(400, 'the fast subtree, 400ms'), { pending: () => html`<p class="waiting">loading fast…</p>`, then: (t) => html`<p class="fast">${t}</p>`, catch: undefined, finally: undefined })}
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
            title: 'a PENDING read makes the walk WAIT',
            note: 'There is no effect to wake in a snapshot, so the walk recovers the only way it can: it waits out the load the read signalled on and calls the thunk again. No block form names the load, no data pass warms it first, and the markup is complete.',
            async run({ is }) {
                const search = memo(async ({ q }: { q: string }) =>
                    ['alpha', 'beta', 'gamma'].filter((w) => w.includes(q)),
                )
                const view = (): TemplateResult =>
                    html`<ul>${() => search({ q: 'a' })().map((word) => html`<li>${word}</li>`)}</ul>`

                is('cold', await renderToString(view()), '<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>')

                // A keyed memo whose own BODY reads something cold. The slot's `start` catches a
                // throwing body and settles the slot as FAILED — right for a body that threw, wrong
                // for one that has not run, and the difference is not a wrong value: the retry finds
                // the slot loaded, serves the retained error, signals again, and does it again. The
                // regression is a BUSY retry loop, so it hangs the whole suite rather than failing
                // this case, and a timeout raced against it never gets a turn to fire.
                const inner = state(new Promise<string>((resolve) => setTimeout(() => resolve('x'), 30)))
                const label = memo(({ id }: { id: number }) => `${id}:${inner()}`)
                is(
                    'a signal is not the failure a slot settles',
                    await renderToString(html`<p>${() => label({ id: 1 })()}</p>`),
                    '<p>1:x</p>',
                )
            },
        },

        {
            title: 'every PRODUCER in the walk is a catcher, not just the slot thunk',
            note: 'A `{#try}` body and a `{#for await}` row run HERE, in the walk, rather than in the thunk that handed the block over — so each needs its own catcher or a cold read inside one signals to nobody and the region renders empty on a snapshot that could have waited. `{#try}` in particular must not treat a read that is merely not ready yet as the failure it exists to catch.',
            async run({ is }) {
                const user = state(Promise.resolve('ada'))
                is(
                    'a cold read inside {#try} — waited for, not caught',
                    await renderToString(
                        html`<p>${() => boundary(() => user(), { catch: () => 'CAUGHT' })}</p>`,
                    ),
                    '<p>ada</p>',
                )

                // …and a real failure still reaches the arm, which is what says the line above is a
                // pending read passing through rather than the boundary having stopped working.
                const down = state(Promise.reject(new Error('down')))
                await settled()
                is(
                    'a FAILED read still reaches {:catch}',
                    await renderToString(
                        html`<p>${() => boundary(() => down(), { catch: () => 'CAUGHT' })}</p>`,
                    ),
                    '<p>CAUGHT</p>',
                )

                const suffix = state(Promise.resolve('!'))
                is(
                    'a cold read inside a {#for await} ROW',
                    await renderToString(
                        html`<ul>${() =>
                            streamed(['a', 'b'], (item: string) => html`<li>${item}${suffix()}</li>`)}</ul>`,
                    ),
                    '<ul><li>a!</li><li>b!</li></ul>',
                )
            },
        },

        {
            title: 'catching a pending read cannot change what renders',
            note: 'A JavaScript `catch` is total — an author’s `try` around a read WILL fire, and no throw can be made to skip it. So the signal is not made invisible, it is made not to MATTER: a body that returns while a read inside it did not is returning output built from a read that never happened, so the boundary throws on its behalf and the output is discarded. The `catch` still runs; the fallback it built is dropped, and both substrates then agree on what the region shows. A real FAILURE is still the author’s to catch — that is the line that says this is a signal travelling through rather than `try` having stopped working.',
            async run({ is }) {
                // The shape this is about: a helper in ordinary TypeScript, where `{#try}` is not
                // available and a bare `catch` is total.
                const swallowing = (read: () => unknown) => (): unknown => {
                    try {
                        return read()
                    } catch {
                        return 'loading…'
                    }
                }

                const user = state(Promise.resolve('ada'))
                const host = scratch(() => html`<p>${swallowing(user)}</p>`)
                is('the fallback is never painted', host.querySelector('p')?.textContent, '')
                await tick()
                is('and the value arrives on the wake', host.querySelector('p')?.textContent, 'ada')
                host.remove()

                // The same helper on the other substrate, and AGREEING with it is the point: before
                // this the client flashed the fallback and the server froze it into the markup.
                const other = state(Promise.resolve('ada'))
                is(
                    'the server waits rather than writing it',
                    await renderToString(html`<p>${swallowing(other)}</p>`),
                    '<p>ada</p>',
                )

                // …and through a DERIVATION, which relays the signal rather than carrying one of its
                // own. The `as string` is what step 4 of docs/ASYNC.md deletes: the read cannot
                // return `undefined` any more, but the TYPE still says it can.
                const third = state(Promise.resolve('ada'))
                const shout = memo(() => (third() as string).toUpperCase())
                is(
                    'relayed through a memo',
                    await renderToString(html`<p>${swallowing(shout)}</p>`),
                    '<p>ADA</p>',
                )

                // The line that says this is a SIGNAL passing through rather than `try` having
                // stopped working.
                const down = state(Promise.reject(new Error('down')))
                await settled()
                is(
                    'a real failure is still the author’s to catch',
                    await renderToString(html`<p>${swallowing(down)}</p>`),
                    '<p>loading…</p>',
                )
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
        {
            title: 'deferring blocks start their loads together too',
            note: 'A deferring block sends its pending arm and the walk moves on, so nothing about the block itself puts its load in flight — the ARM’s own `pending()` probe does, because asking about a load starts it. Three 60ms panels measured 63ms with the probe kicking and 186ms without. Only the peak in flight can tell them apart: every arrangement produces the same document, three deferrals and all, so a markup test passes on the sum.',
            async run({ is }) {
                resetDeferring()
                let markup = ''
                for await (const chunk of renderDocument(
                    '<title>deferring</title>',
                    () => Deferring({}) as never,
                )) {
                    markup += chunk
                }
                is('all three landed', /LEFT[\s\S]*MIDDLE[\s\S]*RIGHT/.test(markup), true)
                is('all three were in flight together', peakDeferring(), 3)
            },
        },
        {
            title: 'a region that WAITS does not hold the walk',
            note: 'A load begins on its first READ, and in a render that read is the walk ARRIVING at the slot — so read in document order, independent loads cost their SUM. The walk does not arrive and wait: a region that has to wait is written into a buffer of its own and spliced back at the position it left, so the walk carries straight on to the next row and starts what THAT reads. It covers a component subtree, a guarded slot, an attribute and a row’s own load the same way, with nothing analysed and nothing for an author to spell — which is what replaced the compiler pass that used to name a page’s unconditional loads and start them at setup. Three 60ms rows measured 183ms holding the walk and 62ms taking a hole, for identical markup, which is why the peak is the assertion and the markup is only the guard on it.',
            async run({ is }) {
                let inFlight = 0
                let peak = 0
                const row = memo(async (label: string) => {
                    inFlight++
                    if (inFlight > peak) peak = inFlight
                    await sleep(20)
                    inFlight--
                    return label
                })
                const markup = await renderToString(
                    html`<ul>${['ONE', 'TWO', 'THREE'].map((label) => html`<li>${() => row(label)}</li>`)}</ul>`,
                )
                is(
                    'every row rendered, in document order',
                    markup,
                    '<ul><li>ONE</li><li>TWO</li><li>THREE</li></ul>',
                )
                is('all three were in flight together', peak, 3)
            },
        },
        {
            title: 'a STREAMED render takes the same hole, up to a cap',
            note: 'Bytes already handed to a consumer cannot be reordered, so this lane looked like the one that had to block — and it does not: what a hole holds back is the markup AFTER it, which has not been sent either. The consumer is given everything up to the first open hole and the walk carries on past it, so three rows cost 63ms rather than 185ms and arrive in document order regardless. The cap is what keeps that honest — past eight chunks’ worth of bytes held behind a hole the walk waits in place, so the buffer is bounded by a chunk count rather than by hope. What may NOT take a hole is a SOURCE: `{#for await}` and a bare async iterable hand over a row at a time, and a hole hands over a region when it is COMPLETE — eight rows collapsed into three chunks, and a channel, which never completes, hung the render outright.',
            async run({ is }) {
                let inFlight = 0
                let peak = 0
                const row = memo(async (label: string) => {
                    inFlight++
                    if (inFlight > peak) peak = inFlight
                    await sleep(20)
                    inFlight--
                    return label
                })
                let markup = ''
                for await (const chunk of renderDocument(
                    '<title>held</title>',
                    () =>
                        html`<ul>${['ONE', 'TWO', 'THREE'].map((l) => html`<li>${() => row(l)}</li>`)}</ul>`,
                )) {
                    markup += chunk
                }
                is('the rows are in document order', /ONE[\s\S]*TWO[\s\S]*THREE/.test(markup), true)
                is('all three were in flight together', peak, 3)
            },
        },
        {
            title: 'an ATTRIBUTE that waits holds only itself',
            note: 'A hole is a splice, and an attribute value is a string like any other — so the element it belongs to, and every slot after it, no longer wait behind one `class=${() => tone()}`. What it cannot do is resume the template at its OWN slot: the static text in front of an attribute is already in the buffer, which is why the hole holds the attribute text rather than the rest of the template. Three attribute loads on one element, which is the arrangement that used to cost their sum.',
            async run({ is }) {
                let inFlight = 0
                let peak = 0
                const attribute = memo(async (label: string) => {
                    inFlight++
                    if (inFlight > peak) peak = inFlight
                    await sleep(20)
                    inFlight--
                    return label
                })
                const markup = await renderToString(
                    html`<p class=${() => attribute('a')} id=${() => attribute('b')} title=${() => attribute('c')}>x</p>`,
                )
                is('every attribute landed, in order', markup, '<p class="a" id="b" title="c">x</p>')
                is('all three were in flight together', peak, 3)
            },
        },
        {
            title: 'a deferred subtree may defer AGAIN',
            note: 'A deferred subtree used to render through `renderToString`, which carries no document — so a deferring block inside one had nowhere to patch and awaited inline, holding its parent’s patch until the inner load landed as well. Two 60ms regions one inside the other reached the reader as one patch at 123ms. With the document carried through, the outer patch goes out at 64ms carrying the inner PLACEHOLDER and the inner follows at 125ms. The total is unchanged and cannot change — the inner load does not exist until the outer producer has been re-run — so what moves is when the outer region is on screen, which is the half a reader is looking at. `drain` reads a list that now GROWS under it, and the order falls out rather than being arranged: a nested patch cannot land before its parent’s, because its load could not start until the parent’s settled.',
            async run({ is }) {
                const outer = memo(async () => {
                    await sleep(20)
                    return 'OUTER'
                })
                const inner = memo(async () => {
                    await sleep(20)
                    return 'INNER'
                })
                const chunks: string[] = []
                for await (const chunk of renderDocument(
                    '<title>nested</title>',
                    () =>
                        html`<div>${() =>
                            outer.pending()
                                ? 'waiting'
                                : html`<p>${outer()}${() => (inner.pending() ? 'waiting' : inner())}</p>`}</div>`,
                )) {
                    chunks.push(chunk)
                }
                const patched = chunks.filter((chunk) => chunk.includes('<template id='))
                is('two patches, not one', patched.length, 2)
                // `<slot-s` written down rather than imported, for the reason the probing case gives.
                is(
                    'the first carries OUTER and a placeholder for the inner',
                    patched[0]?.includes('OUTER') === true && patched[0]?.includes('<slot-s') === true,
                    true,
                )
                is('the second is the inner region', patched[1]?.includes('INNER'), true)
            },
        },
        {
            title: 'past the hold cap the walk PATCHES rather than blocks',
            note: 'A hole holds every byte written after it until it fills, and the walk writes those at CPU speed rather than at the load’s — behind a 300ms load, a megabyte of document was held 1.6ms after the first hole. So a streaming render caps what it will hold, and what it does at the cap is the whole of this: it SPILLS. Every open hole becomes an empty placeholder now and a `<template>` plus a `$p` call when it lands, exactly as a `{#if x.pending()}` region does — so the held bytes become sendable, the buffer is bounded, and the loads still run together. Blocking instead bounded the buffer by refusing to write more, at the price of the loads after it starting one at a time: 224ms against 108ms on this page. The trade is the reader’s rather than the server’s, and it is why the spill is announced on abide’s own channel: a patched region needs JAVASCRIPT to appear, so a crawler sees the placeholder. It cannot reach a STRING render, whose buffer is its output and which therefore holds everything by construction — `renderToString` and `renderDocumentToString` always produce complete markup.',
            async run({ is }) {
                let inFlight = 0
                let peak = 0
                const panel = memo(async (label: string) => {
                    inFlight++
                    if (inFlight > peak) peak = inFlight
                    await sleep(20)
                    inFlight--
                    return label
                })
                // Two of these between the loads is more than a walk may hold.
                const filler = html`<p>${'x'.repeat(60000)}</p>`
                let markup = ''
                let patches = 0
                const drained = (async () => {
                    for await (const chunk of renderDocument(
                        '<title>spill</title>',
                        () =>
                            html`<div>${() => panel('ONE')}${filler}${() => panel('TWO')}${filler}${() => panel('THREE')}${filler}</div>`,
                    )) {
                        markup += chunk
                        if (chunk.includes('<template id=')) patches++
                        // A consumer paying for BYTES rather than a toll per chunk — a socket — which is
                        // what puts the walk under back-pressure and keeps it there while the spill lands
                        // beside it. That pairing is what stranded the walk: `flush` built a second park
                        // promise and replaced the resolver the consumer was about to call, so the walk
                        // waited on one nobody held. It hangs rather than fails, which is the worst shape
                        // a regression can take, so the drain below is raced against a deadline.
                        await sleep(Math.max(1, Math.round(chunk.length / 4000)))
                    }
                })()
                // A stranded walk never ends, and a suite that HANGS reports nothing at all — so the
                // deadline is what turns that regression into a red line instead of a stuck run.
                let deadline: ReturnType<typeof setTimeout> | undefined
                try {
                    await Promise.race([
                        drained,
                        new Promise<never>((_, fail) => {
                            deadline = setTimeout(
                                () =>
                                    fail(
                                        new Error(
                                            'the render never finished — the walk was stranded on a park nobody held',
                                        ),
                                    ),
                                4000,
                            )
                        }),
                    ])
                } finally {
                    clearTimeout(deadline)
                }
                is('all three were in flight together', peak, 3)
                is('the spilled regions arrived as patches', patches > 0, true)
                // `<slot-s` written down rather than imported, for the reason the probing case gives.
                is(
                    'and their placeholders went out empty',
                    markup.includes('<slot-s id="s0"></slot-s>'),
                    true,
                )
                // NOT in document order, and that is the trade rather than a defect: a spilled
                // region's markup arrives after everything the walk wrote past it, and `$p` is what
                // puts it back where it belongs.
                is(
                    'every panel is in the document',
                    ['ONE', 'TWO', 'THREE'].every((label) => markup.includes(label)),
                    true,
                )
            },
        },
        {
            title: 'an ATTRIBUTE that waits is never what a spill gives up',
            note: 'A spill turns an open hole into a placeholder ELEMENT and patches the region in later, which works because every branch that takes a hole writes a REGION — markup that stands on its own between two nodes. An attribute slot does not: what it writes is ` class="tone"`, and its hole sits INSIDE a start tag. Give that one up the same way and the document says `<div <slot-s id="s0"></slot-s>>`, which is not markup, and there is no element for the client to patch into. So an attribute hole is a buffer segment and nothing more — it is never offered to the cap. The case needs all three parts to bite: an attribute that suspends, then more than the cap in bytes behind it, then a LATER branch that waits and triggers the spill for everybody. It reads as a correctness test and it is one, but the mechanism it guards is a cost decision — which is why the assertion is on the SHAPE of the start tag rather than on the page rendering at all.',
            async run({ is }) {
                const tone = memo(async () => {
                    await sleep(20)
                    return 'settled-tone'
                })
                const panel = memo(async (label: string) => {
                    await sleep(40)
                    return label
                })
                // Two of these behind the attribute is more than the walk may hold.
                const filler = html`<p>${'x'.repeat(60000)}</p>`
                let markup = ''
                const drained = (async () => {
                    for await (const chunk of renderDocument(
                        '<title>attribute spill</title>',
                        () =>
                            html`<div class=${() => tone()}>${filler}${() => panel('ONE')}${filler}${() => panel('TWO')}</div>`,
                    )) {
                        markup += chunk
                        // A consumer paying for BYTES, like the case above: back-pressure is what
                        // keeps the walk at the cap while the spill lands beside it.
                        await sleep(Math.max(1, Math.round(chunk.length / 4000)))
                    }
                })()
                let deadline: ReturnType<typeof setTimeout> | undefined
                try {
                    await Promise.race([
                        drained,
                        new Promise<never>((_, fail) => {
                            deadline = setTimeout(() => fail(new Error('the render never finished')), 4000)
                        }),
                    ])
                } finally {
                    clearTimeout(deadline)
                }
                // The whole of it: a placeholder opening while a start tag is still open. Written as
                // a scan for `<slot-s` with no `>` between it and the tag that precedes it, because
                // the broken shape is legal-looking text and `includes` cannot tell it from the
                // legitimate placeholders this page also has.
                // No `\s` before `<slot-s`: an attribute slot's cut takes the ` class=` INCLUDING the
                // space in front of it, so the broken shape is `<div<slot-s ...>`. A `>` cannot appear
                // between the two, which is what keeps this off the legitimate placeholders — those
                // all sit after a tag that closed.
                is('no placeholder was written inside a start tag', /<[a-z][^>]*<slot-s/.test(markup), false)
                is('the attribute arrived on the element', markup.includes('class="settled-tone"'), true)
                is(
                    'and the regions that CAN spill still did',
                    ['ONE', 'TWO'].every((label) => markup.includes(label)),
                    true,
                )
            },
        },
        {
            title: 'a region that PROBED defers, whatever the spelling',
            note: 'Deferring used to be decided by the compiler matching `{#if <state>.pending()}` as the whole of a chain’s first test, so every other spelling fell through to a read and BLOCKED — right markup, one round trip later, and no way to say which you wanted. The walk decides now: a producer that asked about a load and did not get one has, by that fact, something to show while it runs, so what it made is the placeholder and it is called again on the settle. A ternary is the case no regex reached. A plain read is the case this must NOT catch — it signals rather than probing, so it still blocks and its markup is complete, which is what a reader running no scripts needs.',
            async run({ is }) {
                const probed = memo(async () => {
                    await sleep(20)
                    return 'PROBED'
                })
                const read = memo(async () => {
                    await sleep(20)
                    return 'READ'
                })

                let deferring = ''
                for await (const chunk of renderDocument(
                    '<title>t</title>',
                    () =>
                        // No `{#if}`, no `awaited` — the thunk the compiler emits for a ternary.
                        html`<p>${() => (probed.pending() ? 'waiting' : probed())}</p>`,
                )) {
                    deferring += chunk
                }
                is('the placeholder went out', deferring.includes('waiting'), true)
                // `<slot-s` written down rather than imported, for the reason the case above gives:
                // a renamed tag makes this vacuous rather than wrong, and the two assertions
                // bracketing it are what would fail then.
                is('…in a patchable slot', deferring.includes('<slot-s'), true)
                is('…and the settled value followed it', deferring.includes('PROBED'), true)

                let blocking = ''
                for await (const chunk of renderDocument(
                    '<title>t</title>',
                    () => html`<p>${() => read()}</p>`,
                )) {
                    blocking += chunk
                }
                is('a plain read blocks instead', blocking.includes('READ'), true)
                is('…with no placeholder to patch', blocking.includes('<slot-s'), false)
            },
        },
        {
            title: 'a stream the render drained is seeded by its TRANSCRIPT',
            note: 'The handover a long stream used to lose. A server render drains the stream to build the markup, and the browser then re-streamed from the top — duplicated rows for a list, and for a generated answer the WHOLE generation, paid a second time and watched restarting. A stream has no one answer to seed WHILE it runs, since its value is the latest chunk; by the time the document serialises there is one, because the seed block is written after every deferred region settles and a streamed region drains before that. The transcript is what goes down, and the client hands it to `set` as a whole rather than replaying it chunk by chunk — a `for await` costs a tick each, and a hydrating region reading a half-filled transcript rebuilds its rows against markup already holding all of them. What it costs is the answer in the document twice, once as markup and once as JSON, which is what `seed: false` is for on a transcript too big to say twice.',
            async server({ is }) {
                const wire = loopback()
                const tokens = GET(async function* ({ prompt }: { prompt: string }) {
                    for (const word of prompt.split(' ')) yield word
                })
                register('rpc', [['demo/render/tokens', 'tokens']], { tokens })
                const remoteTokens = remote<{ prompt: string }, string>('demo/render/tokens', {
                    base: wire.base,
                    fetch: wire.fetch,
                    stream: true,
                })

                // A `server` face, and the request scope is the whole reason: seeding is COLLECTED
                // on the scope, so `openSeeding` finds nothing to open without one and the block is
                // never written. A browser has no `AsyncLocalStorage` to give it one.
                let markup = ''
                const rendering = renderDocument(
                    '<title>t</title>',
                    () =>
                        html`<article>${() =>
                            streamed(
                                remoteTokens({ prompt: 'the quick brown fox' }),
                                (word: string) => html`<span>${word}</span>`,
                            )}</article>`,
                )
                await serve(new Request('http://x/'), async () => {
                    for await (const chunk of rendering) markup += chunk
                })

                is('every chunk is in the markup', /the[\s\S]*quick[\s\S]*brown[\s\S]*fox/.test(markup), true)
                is('the document carries a seed block', markup.includes('id="abide-seed"'), true)
                // The TRANSCRIPT, not the latest chunk — the thing that lets the browser skip the
                // whole stream rather than replay its tail.
                const block = /id="abide-seed"[^>]*>([\s\S]*?)<\/script>/.exec(markup)
                const seeded = JSON.parse((block as RegExpExecArray)[1] as string) as Record<string, unknown>
                const key = Object.keys(seeded).find((name) => name.startsWith('demo/render/tokens'))
                is('…keyed by the address the stub was built with', key !== undefined, true)
                is('…holding the whole transcript', seeded[key as string], ['the', 'quick', 'brown', 'fox'])
            },
        },

        {
            title: 'a handler that built its own RESPONSE is not seeded — and a FRAMING is not one',
            note: 'A seed is a VALUE the browser can adopt instead of asking, and a `Response` is not one: `json`, `page` and `redirect` hand an in-process caller the envelope, which `JSON.stringify` writes as `{}`. Seeded, the browser adopts `{}` as a settled answer and never asks — a render that so much as TOUCHED such an endpoint left every client reader of it permanently empty, with no request in the network panel to explain it. `jsonl()` and `sse()` used to be in that set and are not any more: a framing is a STREAM, so the lane takes its values, the state holds the chunks and the seed is the transcript — the same seed a `function*` handler gets, which is the point. What decides is the VALUE and not the declaration, because `isGenerator` cannot see a framing and a hand-written `register` never goes near the compiler that can.',
            async server({ is }) {
                async function* items(): AsyncGenerator<{ id: number }> {
                    for (let id = 1; id <= 3; id++) yield { id }
                }
                const framed = GET(() => jsonl(items()))
                const built = GET(() => json({ ok: true }))
                // The control: an ordinary value, which must STILL be seeded. A fix that simply
                // stopped seeding would pass every assertion above and none of this one.
                const plain = GET(() => ({ name: 'ada' }))
                register(
                    'rpc',
                    [
                        ['demo/seed/framed', 'framed'],
                        ['demo/seed/built', 'built'],
                        ['demo/seed/plain', 'plain'],
                    ],
                    { framed, built, plain },
                )

                let markup = ''
                const rendering = renderDocument(
                    '<title>t</title>',
                    () =>
                        html`<article>${() =>
                            streamed(
                                framed(),
                                (row: { id: number }) => html`<span>${row.id}</span>`,
                            )}</article>
                            <p>${() => (built()() instanceof Response ? 'envelope' : 'value')}</p>
                            <p>${() => plain()().name}</p>`,
                )
                await serve(new Request('http://x/'), async () => {
                    for await (const chunk of rendering) markup += chunk
                })

                // The isomorphism, in the one place it used to break: a framed handler hands a caller
                // IN PROCESS what the same call hands a browser. It answered its own `Response` here.
                is(
                    'a framed handler answers its VALUES in process',
                    /<span>1<[\s\S]*<span>2<[\s\S]*<span>3</.test(markup),
                    true,
                )
                is('…and one that built a Response still answers that', markup.includes('envelope'), true)

                const block = /id="abide-seed"[^>]*>([\s\S]*?)<\/script>/.exec(markup)
                const seeded = JSON.parse((block as RegExpExecArray)[1] as string) as Record<string, unknown>
                const keyed = (prefix: string): string | undefined =>
                    Object.keys(seeded).find((name) => name.startsWith(prefix))

                is('a hand-built Response seeds nothing', keyed('demo/seed/built'), undefined)
                is('…an ordinary value still does', seeded[keyed('demo/seed/plain') as string], {
                    name: 'ada',
                })
                // By its TRANSCRIPT, which is what stops the browser re-streaming what is already on
                // the page — and what it got before was the generator object, written as `{}`.
                is('…and a framing by its whole transcript', seeded[keyed('demo/seed/framed') as string], [
                    { id: 1 },
                    { id: 2 },
                    { id: 3 },
                ])
            },
        },
    ],
})
