// The `.abide` compiler: a file becomes the module a careful author would have written by hand.
//
// Every case here compiles a source string with the SAME `compile` the Bun loader calls, so what is
// asserted is the emitted text — and then, where the claim is about behaviour rather than shape, the
// emitted component is rendered through both substrates. The headline case is the parity one:
// `app.abide` and `app.ts` are the same component written twice, and the compiler's whole claim is
// that the two are indistinguishable at the output AND at the cost.

import { adopt, styleTags } from 'abide'
import { compile, originalPosition } from 'abide/compiler'
import { renderToString } from 'abide/server'
import { container, install, keep, measureFlush, nonZero, sleep, suite, tick, until } from 'abide/tests'
import { mount } from 'abide/ui'
import Compiled, {
    count as compiledCount,
    filter as compiledFilter,
    search as compiledSearch,
    session as compiledSession,
} from '../app.abide'
import { count, filter, search as handSearch, App as handWritten, session } from '../app.ts'
import { button, row, stage } from './dom.ts'
import Card from './fixtures/card.abide'
import Library, { details, query, shelf, summary } from './fixtures/library.abide'
// The same file's own text, inlined by the loader — a browser has no `Bun` to read it with.
import LIBRARY from './fixtures/library.abide?source'
import Loader, { calls, label } from './fixtures/loader.abide'
import Narrow, { session as narrowSession } from './fixtures/narrow.abide'
import Rows, { items, rate } from './fixtures/rows.abide'
import Stream, { failing, room } from './fixtures/stream.abide'
import Widget, { text as widgetText } from './fixtures/widget.abide'
import { META } from './SUITES.ts'

install()

/**
 * Markup with whitespace collapsed. The two files are laid out differently on the page — one has its
 * text on a single line — and a difference in source formatting is not a difference in output.
 */
function normalize(markup: string): string {
    return markup
        .replace(/\s+/g, ' ')
        .replace(/\s*(<|>)\s*/g, '$1')
        .trim()
}

/** How long the streaming case waits for a row that a throttled tab may be a second late with. */
const STREAM_BUDGET_MS = 20_000

/** Compile a fragment and hand back just the template, which is what most claims are about. */
function template(source: string): string {
    const code = compile(source, { filename: 'Case.abide' }).code
    const start = code.indexOf('return html`')
    return code.slice(start + 'return html`'.length, code.lastIndexOf('`')).trim()
}

export default suite({
    ...META.compiler,
    cases: [
        {
            title: 'a read desugars, and naming a cell alone hands over the CELL',
            note: 'Using a name in an expression reads it; naming it alone passes it. That is what `bind:value={x}` and a component prop need — and a slot renders it as its value anyway, because `unwrap` reads a slot’s cell one step further.',
            run({ is }) {
                is(
                    'used in an expression — a read',
                    template('<script>const n = state(0)</script><p>{n + 1}</p>'),
                    '<p>${() => n() + 1}</p>',
                )
                is(
                    'named alone — the cell itself',
                    template('<script>const n = state(0)</script><p>{n}</p>'),
                    '<p>${() => n}</p>',
                )
                is(
                    'a member read',
                    template('<script>const s = state("ab")</script><p>{s.length}</p>'),
                    '<p>${() => s().length}</p>',
                )
                is(
                    'the cell surface is reserved',
                    template('<script>const s = state("ab")</script><p>{s.pending()}</p>'),
                    '<p>${() => s.pending()}</p>',
                )
                is(
                    'the explicit spelling still compiles',
                    template('<script>const n = state(0)</script><p>{n()}</p>'),
                    '<p>${() => n()}</p>',
                )
            },
        },

        {
            title: 'a write desugars to `set`, and never subscribes',
            note: 'A compound write reads through `peek`: a write that subscribed to what it is about to overwrite would wake itself. `++` is statement-only, since a `set` has no value to hand back.',
            run({ is }) {
                const one = (body: string): string =>
                    template(`<script>const n = state(0)</script><button onclick={${body}}>x</button>`)
                is('assignment', one('() => n = 5'), '<button @click=${() => n.set(5)}>x</button>')
                is(
                    'compound reads through peek',
                    one('() => n += 1'),
                    '<button @click=${() => n.set(n.peek() + 1)}>x</button>',
                )
                is('increment', one('() => n++'), '<button @click=${() => n.set(n.peek() + 1)}>x</button>')
                is(
                    'the right-hand side is desugared too',
                    one('() => n = n + 1'),
                    '<button @click=${() => n.set(n() + 1)}>x</button>',
                )
            },
        },

        {
            title: 'shadowing is tracked, so a loop variable is not read as a cell',
            note: 'The one way a desugar can be silently WRONG: rewriting `items.map((count) => count)` when an outer `count` cell exists produces working-looking code that reads the wrong thing. Bindings are collected in a first pass, because a parameter is written before the scope it opens.',
            run({ is }) {
                const source = '<script>const count = state(0)</script>'
                is(
                    'a parameter shadows',
                    template(`${source}<p>{items.map((count) => count).join("")}</p>`),
                    '<p>${() => items.map((count) => count).join("")}</p>',
                )
                is(
                    '…and the outer one still reads after it',
                    template(`${source}<p>{items.map((c) => c) + count}</p>`),
                    '<p>${() => items.map((c) => c) + count()}</p>',
                )
                is(
                    'a {#for} binding shadows',
                    template(`${source}<ul>{#for count of xs}<li>{count}</li>{/for}</ul>`),
                    '<ul>${() => (xs ?? []).map((count) => html`<li>${() => count}</li>`)}</ul>',
                )
            },
        },

        {
            title: 'a quoted attribute interpolates — the limit the runtime has, the compiler lifts',
            note: 'The runtime requires an attribute slot to be a WHOLE value written unquoted, because a slot cannot be part of one. The compiler owns the whole attribute, so it folds the literal and the holes into one expression and the restriction disappears.',
            async run({ is }) {
                is(
                    'literal and hole in one value',
                    template('<script>const n = state(2)</script><a href="/x/{n}/y">go</a>'),
                    '<a href=${() => `/x/${n()}/y`}>go</a>',
                )
                // …and the fixture proves it renders, loaded through the real plugin.
                const markup = await renderToString(Widget({}) as never)
                is('and it renders', /<a href="\/x\/two\/y">go<\/a>/.test(markup), true)
            },
        },

        {
            title: 'class: and style: merge into ONE attribute, not one slot each',
            note: '`class` is a single attribute however many toggles it carries, so the static value and every toggle are handed to one `classes()` call. On a component the same syntax is a compile error — there is no element to toggle a class on.',
            run({ is, throws }) {
                is(
                    'static plus two toggles',
                    template(
                        '<script>const n = state(3)</script><p class="card" class:high={n > 2} class:low={n <= 2}>x</p>',
                    ),
                    '<p class=${() => classes("card", [n() > 2, "high"], [n() <= 2, "low"])}>x</p>',
                )
                is(
                    'a style property',
                    template('<script>const w = state(1)</script><p style:width={w}>x</p>'),
                    '<p style=${() => styles("", ["width", w()])}>x</p>',
                )
                throws('class: on a component', () => template('<Card class:big={true}/>'), 'component')
            },
        },

        {
            title: 'bind:value is a read AND a write, so it compiles to two slots',
            note: 'One spelling, two bindings on the same element: a property slot for the value and a listener that writes back. The listener carries the element’s own type, because the emitted file is type-checked like any other — an untyped `event` there is an implicit `any` in the author’s build. `bind:checked` also emits the boolean ATTRIBUTE, so the state survives SSR.',
            async run({ is }) {
                is(
                    'value',
                    template('<script>const f = state("")</script><input bind:value={f} />'),
                    '<input .value=${() => f()} @input=${(event: Event) => f.set((event.currentTarget as HTMLInputElement).value)} />',
                )
                is(
                    'checked mirrors an attribute too',
                    template('<script>const on = state(true)</script><input bind:checked={on} />'),
                    '<input .checked=${() => !!on()} checked=${() => !!on()} @change=${(event: Event) => on.set((event.currentTarget as HTMLInputElement).checked)} />',
                )

                // The round trip, live: the cell writes the property, and typing writes the cell.
                const host = container()
                mount(host, () => Widget({}) as never)
                const input = host.querySelector('input') as HTMLInputElement
                is('the property was written', input.value, 'a')
                input.value = 'ab'
                input.dispatchEvent(new Event('input'))
                is('and the listener wrote back', widgetText.peek(), 'ab')
                widgetText.set('a')

                // A boolean bind mirrors the ATTRIBUTE too, which is what survives SSR.
                // A boolean attribute goes BARE when true, which is the whole reason the compiler
                // emits an attribute slot alongside the property one — a property has no
                // serialisation, so `.checked` alone would leave nothing behind for SSR.
                is(
                    'checked survives a server render',
                    /<input type="checkbox" checked\s*\/?>/.test(await renderToString(Widget({}) as never)),
                    true,
                )
                host.remove()
            },
        },

        {
            title: 'control flow is ordinary expressions, one thunk per hole',
            note: 'The thunk around an `{#if}` subscribes to its CONDITION and nothing else, because evaluating an `html` tag does not call the thunks inside it. Wrapping a whole branch body in one thunk would produce identical output at a much coarser wake — which is why the shape is asserted, not just the render.',
            run({ is }) {
                is(
                    'if / else if / else',
                    template('{#if a}<b>x</b>{:else if b}<i>y</i>{:else}z{/if}'),
                    '${() => a ? html`<b>x</b>` : b ? html`<i>y</i>` : html`z`}',
                )
                is(
                    'switch',
                    template('{#switch m}{:case "a"}A{:default}D{/switch}'),
                    '${() => m === "a" ? html`A` : html`D`}',
                )
                is(
                    'a keyed for MOVES its rows',
                    template('<ul>{#for w of ws by w}<li>{w}</li>{/for}</ul>'),
                    '<ul>${() => (ws ?? []).map((w) => keyed(w, html`<li>${() => w}</li>`))}</ul>',
                )
                is(
                    'keyless is positional',
                    template('<ul>{#for w, i of ws}<li>{i}</li>{/for}</ul>'),
                    '<ul>${() => (ws ?? []).map((w, i) => html`<li>${() => i}</li>`)}</ul>',
                )
            },
        },

        {
            title: 'components: a tag is a call, children are a prop, {#component} is a value',
            note: 'A capitalised tag invokes; `<slot/>` renders what was passed. A nested `{#component X()}` inside a component’s children becomes that component’s `X` prop, which is how a render-prop is spelled without a second concept.',
            run({ is }) {
                is(
                    'invocation with props',
                    template('<Card title="hi" n={1}/>'),
                    '${() => Card({ title: "hi", n: 1 })}',
                )
                is(
                    'children become a prop',
                    template('<Card>hey</Card>'),
                    '${() => Card({ children: html`hey` })}',
                )
                is('a spread', template('<Card {...rest} n={1}/>'), '${() => Card({ ...rest, n: 1 })}')
                is(
                    'onclick on a component is an ordinary prop',
                    template('<Card onclick={go}/>'),
                    '${() => Card({ onclick: go })}',
                )
                is(
                    'slot renders the children',
                    template('<div><slot/></div>'),
                    '<div>${() => args.children}</div>',
                )
            },
        },

        {
            title: '`export` in a <script> is a compile error, and says where to put it',
            note: 'A `<script>` body is inlined into the component setup, so an export there has nowhere to go. `<script module>` IS module scope, so the same statement is fine one block over — the error names that.',
            run({ is, throws }) {
                throws(
                    'export in the setup script',
                    () => compile('<script>export const x = 1</script><p>x</p>'),
                    'nowhere to go',
                )
                is(
                    'the same statement in <script module>',
                    compile('<script module>export const x = 1</script><p>y</p>').code.includes(
                        'export const x = 1',
                    ),
                    true,
                )
            },
        },

        {
            title: 'app.abide and app.ts render identically, on both substrates',
            note: 'The parity claim, and the whole point: `app.ts` is the hand-written arm — the file someone would actually write — and `app.abide` is the same component in the sugared spelling. Same markup from the server, same DOM from the client. A difference here means the compiler is not emitting what a person would.',
            async run({ is }) {
                count.set(0)
                filter.set('')
                compiledCount.set(0)
                compiledFilter.set('')
                // Both sides warm the same way: the slot read is non-blocking, and both cells hold a
                // load, so an unwarmed pair would differ only in which one landed first.
                await Promise.all([
                    handSearch({ q: '' }),
                    compiledSearch({ q: '' }),
                    session,
                    compiledSession,
                ])

                const fromSource = normalize(await renderToString(handWritten()))
                const fromAbide = normalize(await renderToString(Compiled({})))
                is('the server markup is the same', fromAbide, fromSource)

                const a = container()
                const b = container()
                mount(a, () => handWritten())
                mount(b, () => Compiled({}) as never)
                await tick()
                is(
                    'and so is the DOM',
                    normalize((b.querySelector('main') as HTMLElement).innerHTML),
                    normalize((a.querySelector('main') as HTMLElement).innerHTML),
                )
                a.remove()
                b.remove()
            },
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — compiled from .abide, one count write',
                        prepare: () => {
                            const host = container()
                            mount(host, () => Compiled({}) as never)
                        },
                        run: () => compiledCount.set(compiledCount.peek() + 1),
                    },
                    {
                        label: 'vanilla — the hand-written app.ts, one count write',
                        prepare: () => {
                            const host = container()
                            mount(host, () => handWritten())
                        },
                        run: () => count.set(count.peek() + 1),
                    },
                ],
            },
            interact({ host, log }) {
                const out = stage(host)
                mount(out, () => Compiled({}) as never)
                host.append(
                    row(
                        button('count += 1 (through the compiled component)', async () => {
                            const work = await measureFlush(() => compiledCount.set(compiledCount.peek() + 1))
                            log.live('work for one write', nonZero(work))
                        }),
                        // "be" and not "a": every word in the component's list contains an `a`, so
                        // the filter the claim is about narrowed nothing and the list never moved.
                        button('filter.set("be")', () => compiledFilter.set('be')),
                        button('filter.set("")', () => compiledFilter.set('')),
                    ),
                )
            },
        },

        {
            title: 'all three memo forms, read by name',
            note: 'A derive reads its dependencies from the body; an argless async memo takes the ones read BEFORE the first await, which is why `const term = query` is load-bearing; a keyed memo is CALLED, so its name sits in callee position and is never rewritten. The probes and verbs are the reserved surface, so `summary.pending()` and `details.invalidate()` pass through untouched.',
            async run({ is }) {
                query.set('a')
                shelf.set(['dune', 'neuromancer', 'anathem'])
                await summary

                const code = compile(LIBRARY, { filename: 'library.abide' }).code
                is(
                    'a derive reads through the nested arrow, and its parameter does not',
                    code.includes('memo(() => shelf().filter((title) => title.includes(query())))'),
                    true,
                )
                is(
                    'the read before the await is a real dependency',
                    code.includes('const term = query()'),
                    true,
                )
                is(
                    'a keyed memo is read by its CALL, not by its name',
                    code.includes('const $0 = details({ title })()'),
                    true,
                )
                is(
                    '…and the branch narrows off that local, so `.pages` needs no `?.`',
                    code.includes('if ($0) return html`${() => $0.pages} pages`'),
                    true,
                )
                is(
                    '…and the call in callee position is still the explicit read',
                    compile(
                        '<script>const m = memo(async ({ id }: { id: number }) => id)</script><p>{m({ id: 1 })()}</p>',
                    ).code.includes('${() => m({ id: 1 })()}'),
                    true,
                )
                is('probes pass through', code.includes('summary.pending()'), true)
                is('…and verbs', code.includes('summary.refresh()'), true)
                is('and so do verbs', code.includes('details.invalidate()'), true)

                const host = container()
                mount(host, () => Library({}) as never)
                await tick()
                is(
                    'the derive counted the matches',
                    host.querySelector('h2')?.textContent,
                    '2 of 3 on the shelf',
                )

                // `shelf = [...shelf, x]` — a write whose right-hand side reads the same cell.
                const add = host.querySelectorAll('button')[0] as HTMLButtonElement
                add.click()
                await tick()
                is('the write landed and the derive followed', shelf.peek().length, 4)
                is('…on screen too', host.querySelector('h2')?.textContent, '2 of 4 on the shelf')
                host.remove()
            },
        },

        {
            title: 'a condition NARROWS its branch, because it reads once into a const',
            note: 'Every abide read is a call, and TypeScript narrows a const but never a call — so `{#if session}{session.name}{/if}` had no way to typecheck: the test and the use were two separate `session()` calls with nothing tying them together. A condition takes its reads into locals and the branch narrows off those. It also costs LESS: separate reads subscribe to the same cell twice and both wake, where one hoisted read wakes the branch once.',
            async run({ is }) {
                const head =
                    '<script>const s = state(0)\nconst m = memo(async ({ id }: { id: number }) => 1)</script>'
                const body = (source: string): string => {
                    const emitted = compile(head + source, { filename: 'Case.abide' }).code
                    const start = emitted.indexOf('return html`')
                    return emitted.slice(start + 12, emitted.lastIndexOf('`')).trim()
                }
                is(
                    'a cell read once, then narrowed',
                    body('<p>{#if s}{s}{/if}</p>'),
                    '<p>${() => { const $0 = s(); if ($0) return html`${() => $0}`; return null }}</p>',
                )
                is(
                    'a keyed call is hoisted WHOLE, arguments and all',
                    body('<p>{#if m({ id: 1 })}{m({ id: 1 })}{/if}</p>'),
                    '<p>${() => { const $0 = m({ id: 1 })(); if ($0) return html`${() => $0}`; return null }}</p>',
                )
                is(
                    'an else-if is still lazy — its read only runs when the first misses',
                    body('<p>{#if s}a{:else if m({ id: 2 })}b{/if}</p>').includes(
                        'if ($0) return html`a`; const $1 = m({ id: 2 })()',
                    ),
                    true,
                )
                // Reads only. A write inside the branch must still reach the cell, not the local.
                is(
                    'a write in the branch still writes',
                    body('<p>{#if s}<button onclick={() => s = 0}>x</button>{/if}</p>').includes('s.set(0)'),
                    true,
                )
                // A body that reads something ELSE keeps its own thunk, so it still wakes alone.
                is(
                    'only the condition’s own reads are hoisted',
                    body('<p>{#if s}{other}{/if}</p>').includes('html`${() => other}`'),
                    true,
                )

                await narrowSession
                const host = container()
                mount(host, () => Narrow({}) as never)
                await tick()
                is('and the narrowed branch renders', host.querySelector('p')?.textContent, 'ada')
                host.remove()
            },
        },

        {
            title: 'a keyed row renders on the SERVER too, not just in the DOM',
            note: 'A key says which row this is, which only matters to a renderer that MOVES rows — so `keyed` is data, not a client concept, and it belongs on the isomorphic surface. The server carries the key and drops it; what it must never do is stringify the wrapper into `[object Object]`, which is what this asserts.',
            async run({ is }) {
                query.set('a')
                shelf.set(['dune', 'neuromancer', 'anathem'])
                await Promise.all([summary, details({ title: 'anathem' })])
                const markup = await renderToString(Library({}) as never)
                is('the rows rendered', /<li>[\s\S]*?anathem — 280 pages/.test(markup), true)
                is('and no wrapper leaked', markup.includes('[object Object]'), false)
            },
        },

        {
            title: '<style> is scoped by rewriting selectors, with no runtime to pay for',
            note: 'Every element the component writes carries a `data-a<hash>` attribute — STATIC markup, so it costs nothing per render — and every selector gains that attribute on its RIGHTMOST compound. Rightmost is the whole trick: `main p` stays a descendant selector that happens to require the `p` be ours, so an outer rule reaches in and an inner one cannot reach out.',
            async run({ is }) {
                const emitted = compile(
                    '<div><p>x</p></div>\n<style>.a { color: red }\np:hover { color: blue }\n@media (min-width: 1px) { .a { color: teal } }\n@keyframes k { from { opacity: 0 } }</style>',
                    { filename: 'Scoped.abide' },
                ).code
                const scope = /data-a(\w+)/.exec(emitted)?.[0] as string

                is('every element carries the attribute', emitted.includes(`<div ${scope}`), true)
                is('…including nested ones', emitted.includes(`<p ${scope}`), true)
                is('the rightmost compound is scoped', emitted.includes(`.a[${scope}]`), true)
                is('a pseudo keeps its place', emitted.includes(`p[${scope}]:hover`), true)
                is(
                    'an at-rule body is scoped too',
                    emitted.includes(`@media (min-width: 1px) { .a[${scope}]`),
                    true,
                )
                is(
                    '…but keyframes are left alone',
                    emitted.includes('@keyframes k { from { opacity: 0 } }'),
                    true,
                )

                // Registered at module scope, so it lands once however many times it is mounted.
                const before = document.querySelectorAll('style[data-abide]').length
                const host = container()
                mount(host, () => Card({}) as never)
                mount(container(), () => Card({}) as never)
                await tick()
                is('the sheet is adopted once', document.querySelectorAll('style[data-abide]').length, before)
                const article = host.querySelector('article') as HTMLElement
                const applied = Array.from(article.attributes)
                    .map((a) => a.name)
                    .find((n) => n.startsWith('data-a')) as string
                is(
                    'and every rendered element carries the scope',
                    Array.from(host.querySelectorAll('*')).every((e) => e.hasAttribute(applied)),
                    true,
                )
                host.remove()
            },
        },

        {
            title: 'the sheet crosses to the client TAGGED, so it is not served twice',
            note: 'A server render puts one `<style data-abide="…">` per scope in `<head>`, and `adopt` looks for exactly that before appending its own. The scope name is the whole contract: an anonymous blob is one a hydrating client cannot recognise, so every scoped component\'s rules went out once from the server and again from the client.',
            async run({ is }) {
                const scope = 'data-aSpec01'
                const css = `.spec[${scope}] { color: red }`

                // The server half: one tagged element per scope, not one anonymous blob.
                adopt(scope, css)
                const tags = styleTags()
                is('the block is tagged with its scope', tags.includes(`<style data-abide="${scope}">`), true)
                is('and carries its rules', tags.includes(css), true)

                // The client half: the document already has it, so `adopt` must leave it alone.
                const already = 'data-aSpec02'
                const served = document.createElement('style')
                served.setAttribute('data-abide', already)
                served.textContent = `.b[${already}] { color: blue }`
                document.head.append(served)

                adopt(already, `.b[${already}] { color: blue }`)
                is(
                    'a scope the server already wrote is not appended again',
                    document.head.querySelectorAll(`style[data-abide="${already}"]`).length,
                    1,
                )
                served.remove()
            },
        },

        {
            title: '{#await} splits the operand from its branches, so a promise cannot re-make itself',
            note: 'The thunk evaluates ONLY the operand and hands over four unevaluated closures, so its effect subscribes to what the operand reads and nothing else — the part paints the branches later without ever waking it. Choosing a branch in the thunk instead, by reading `pending()`, makes settling wake the thunk, which re-evaluates the operand into a fresh promise, which settles: an unbounded loop with real requests behind it. Counting the operand evaluations is the only way to see this; the output looks right either way.',
            async run({ is }) {
                const emitted = compile('<p>{#await p}a{:then v}b{:catch e}c{/await}</p>', {
                    filename: 'A.abide',
                }).code
                is(
                    'the branches are closures, unevaluated',
                    emitted.includes(
                        'awaited(p, { pending: () => html`a`, then: (v) => html`b`, catch: (e) => html`c` })',
                    ),
                    true,
                )

                const before = calls()
                const host = container()
                mount(host, () => Loader({}) as never)
                is('the pending branch first', host.textContent?.includes('loading…'), true)

                await sleep(80)
                is('then the settled one', host.textContent?.includes('ada'), true)
                is('the operand was evaluated ONCE', calls() - before, 1)

                // An unrelated dependency moving must not throw a settled branch back to pending,
                // and must not re-run the operand.
                label.set('moved')
                await tick()
                is('an unrelated write leaves the branch settled', host.textContent?.includes('ada'), true)
                is('…and does not re-evaluate the operand', calls() - before, 1)

                await sleep(120)
                is('and it is still settled, not looping', calls() - before, 1)
                host.remove()
            },
        },

        {
            title: '{#for await} streams rows, and a new source re-streams rather than interleaving',
            note: 'Reactive, not one-shot: the enclosing effect re-runs when the source’s dependencies move, and the generation stamp tears the old stream down. Rows are handed to the same `ListPart` a `{#for}` uses, so a keyed row still moves rather than being rewritten.',
            async run({ is }) {
                room.set('lobby')
                const host = container()
                mount(host, () => Stream({}) as never)
                const rows = (): (string | null)[] =>
                    Array.from(host.querySelectorAll('li')).map((li) => li.textContent)

                // Waited FOR rather than slept past — every wait in this case. The fixture yields
                // every 8 ms, so a fixed `sleep` was asserting that exactly N rows had landed inside
                // a few-millisecond margin: a claim about the timer, not about the stream, and it
                // failed whenever the machine was busy. What the case is actually about — rows in
                // yield order, and a second source that does not INTERLEAVE — holds at any speed.
                //
                // The budget is generous because a card starts on LOAD: a page opened in a background
                // tab has its timers clamped to about a second each, which turns a 24 ms stream into
                // a three-second one and failed the card the reader eventually switched to.
                await until(() => rows().length === 3, STREAM_BUDGET_MS)
                is('rows arrive as they are yielded', rows(), ['lobby 1', 'lobby 2', 'lobby 3'])

                room.set('bad')
                await until(() => rows().some((line) => line?.startsWith('bad') === true), STREAM_BUDGET_MS)
                is(
                    'a new source starts over, it does not interleave',
                    rows().filter((line) => line?.startsWith('lobby') === true),
                    [],
                )

                await until(() => rows()[0] === 'Error: stream failed', STREAM_BUDGET_MS)
                is('and {:catch} takes a source that threw', rows(), ['Error: stream failed'])
                host.remove()
            },
        },

        {
            title: '{#try} is one unit, which is what lets it catch at all',
            note: 'The body is emitted UNTHUNKED — the one place the compiler does not give each expression its own thunk. An expression that produced its value in a nested effect would throw into that effect’s own isolation, past the boundary, and the boundary would catch nothing. The cost is stated rather than hidden: a dependency inside a boundary re-runs the whole body.',
            async run({ is }) {
                const emitted = compile('<p>{#try}{risky()}{:catch e}bad{/try}</p>', {
                    filename: 'T.abide',
                }).code
                is(
                    'the body is one thunk, its expressions unthunked',
                    emitted.includes('boundary(() => html`${risky()}`, { catch: (e) => html`bad` })'),
                    true,
                )
                // A thunk IS a deferral, so a nested block would push its throw out of the try too.
                is(
                    'and a nested block is evaluated in place as well',
                    compile('<p>{#try}{#if risky()}a{/if}{:catch e}bad{/try}</p>', {
                        filename: 'T.abide',
                    }).code.includes('html`${(() => risky() ? html`a` : null)()}`'),
                    true,
                )

                failing.set(true)
                const host = container()
                mount(host, () => Stream({}) as never)
                await tick()
                is('the throw is caught', host.querySelector('i')?.textContent, 'caught: Error: boom')
                is('and {:finally} rendered anyway', host.querySelector('small')?.textContent, 'done')

                failing.set(false)
                await tick()
                is('a dependency moving re-runs the body', host.querySelector('b')?.textContent, 'fine')
                is('…and {:finally} still rendered', host.querySelector('small')?.textContent, 'done')
                host.remove()
            },
        },

        {
            title: 'a reactive constructor with a TYPE ARGUMENT is still a source',
            note: '`state<Received<T>>(…)` is an ordinary declaration. Matching only `NAME = state(` missed it — the token before the paren is `>` — and the binding silently stopped being reactive, which surfaces much later as a method call landing on the State instead of on the value it holds.',
            run({ is }) {
                const emitted = compile(
                    '<script>const s = state<string | null>("a")</script><p>{s?.length}</p>',
                    { filename: 'G.abide' },
                ).code
                is('the read is desugared', emitted.includes('${() => s()?.length}'), true)
                const nested = compile(
                    '<script>const s = state<Map<string, number>>(new Map())</script><p>{s.size}</p>',
                    { filename: 'G.abide' },
                ).code
                is('…including through a nested `>>`', nested.includes('${() => s().size}'), true)
            },
        },

        {
            title: 'a branch-local <script> is per-ITEM, and shadows what it names',
            note: 'Top-level blocks are lifted before the template is parsed; a nested one is left in place and becomes a node, so its bindings live in the level’s own closure. `{#for}` splices the statements into the row closure it already has — everywhere else pays one call, which is the honest cost of a body that was an expression.',
            async run({ is, throws }) {
                const emitted = compile(
                    '<script>const n = state(1)</script><ul>{#for x of xs}<script>const n = x * 2</script><li>{n}</li>{/for}</ul>',
                    { filename: 'R.abide' },
                ).code
                is(
                    'the statements go straight into the row closure',
                    emitted.includes('(x) => {\nconst n = x * 2\nreturn html`<li>${() => n}</li>`'),
                    true,
                )

                // The one way this could be silently wrong: the branch-local name still reading the
                // outer source. Asking whether the INHERITED set holds it answers the wrong question.
                rate.set(2)
                items.set([{ id: 'a', width: 3, height: 4 }])
                const host = container()
                mount(host, () => Rows({}) as never)
                await tick()
                is(
                    'inside, the shadowing binding wins',
                    host.querySelector('li')?.textContent?.trim(),
                    'a — area 12, ratio 3:4',
                )
                is(
                    'outside, the source is untouched',
                    host.querySelector('p')?.textContent,
                    'outer rate is still a source: 2',
                )
                rate.set(9)
                await tick()
                is(
                    '…and still reactive',
                    host.querySelector('p')?.textContent,
                    'outer rate is still a source: 9',
                )
                host.remove()

                throws(
                    'it must be the FIRST node of its body',
                    () => compile('<ul>{#for x of xs}<li>a</li><script>const b = 1</script>{/for}</ul>'),
                    'FIRST node',
                )
                throws(
                    'and carries no import',
                    () => compile("<ul>{#for x of xs}<script>import { y } from 'z'</script>{/for}</ul>"),
                    'no `import`',
                )
            },
        },

        {
            title: 'a diagnostic is moved back onto the .abide line',
            note: 'The checker reads the generated module and reports positions in it, which is a file the author never wrote. Every copied expression is emitted behind an invisible marker; one pass over the finished string lifts the markers out into a v3 source map, so no generated position had to be threaded through the emitter. The LINE is exact; the column drifts within an expression by however much the desugar inserted.',
            run({ is }) {
                const source = [
                    '<script module>',
                    "import { state } from 'abide'",
                    "const user = state({ name: 'ada' })",
                    '</script>',
                    '',
                    '<div>',
                    '    <p>{user.name}</p>',
                    '</div>',
                ].join('\n')
                const { code, segments, map } = compile(source, { filename: 'Probe.abide' })

                is('a mapping was recorded', segments.length > 0, true)
                is('the map inlines the source', JSON.parse(map).sourcesContent[0], source)
                is('and names the .abide file', JSON.parse(map).sources[0], 'Probe.abide')
                is('no marker survives into the code', /[\uE000\uE001]/.test(code), false)

                // The generated read sits somewhere in the emitted template; find it and map back.
                const lines = code.split('\n')
                const row = lines.findIndex((line) => line.includes('user().name'))
                const column = (lines[row] as string).indexOf('user().name')
                const at = originalPosition(segments, row, column)
                is('the line is the one the author wrote', at?.line, 7)
                is('…and the column starts at the expression', at?.column, 9)
            },
        },

        {
            title: 'the emitted file is one a person can read',
            note: 'Not a pre-scanned TemplateResult: the scan and the parse are cached on the `strings` identity a tagged template gives for free, so pre-scanning would buy one scan per call site per process and cost a stack trace that points at something nobody wrote.',
            run({ is, log }) {
                const code = compile(
                    '<script>\nconst n = state(0)\n</script>\n<p onclick={() => n++}>{n}</p>\n',
                    { filename: 'Counter.abide' },
                ).code
                is(
                    'the export is named after the file',
                    code.includes('export default function Counter'),
                    true,
                )
                is(
                    'it imports only what it used',
                    code.split('\n')[0],
                    "import { html, type TemplateResult } from 'abide'",
                )
                is('no compiler runtime of its own', code.includes('abide/compiler'), false)
                log('emitted', code)
            },
        },

        {
            title: 'what compiling a file costs',
            note: 'The one number in this repo paid at BUILD time rather than per render, and the one nothing was measuring — which is how a compiler acquires a second pass nobody notices. Two sizes, because one cannot tell a per-line cost from a fixed one: a real component against a three-line one, both compiled the same way, plus the floor of handing the source straight back.',
            bench: {
                kind: 'time',
                arms: (() => {
                    const TINY = '<script>\nconst n = state(0)\n</script>\n<p onclick={() => n++}>{n}</p>\n'
                    return [
                        {
                            // A fresh filename per op: `compile` is pure and caches nothing, but a
                            // name reused every iteration is the shape that would hide it if it did.
                            label: 'abide — compile() a real component',
                            run: (i: number) =>
                                keep(compile(LIBRARY, { filename: `library${i % 4}.abide` }).code),
                        },
                        {
                            label: 'abide — compile() a three-line one',
                            run: (i: number) => keep(compile(TINY, { filename: `tiny${i % 4}.abide` }).code),
                        },
                        {
                            label: 'vanilla — hand the source back untouched',
                            run: () => keep(LIBRARY.length),
                        },
                    ]
                })(),
            },
        },
    ],
})
