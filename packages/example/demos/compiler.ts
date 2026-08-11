// The `.abide` compiler: a file becomes the module a careful author would have written by hand.
//
// Every case here compiles a source string with the SAME `compile` the Bun loader calls, so what is
// asserted is the emitted text — and then, where the claim is about behaviour rather than shape, the
// emitted component is rendered through both substrates. The headline case is the parity one:
// `counter.abide` and `counter.ts` are the same component written twice, and the compiler's whole claim is
// that the two are indistinguishable at the output AND at the cost.

import { html } from 'abide'
import { styleTags } from 'abide/server'
import { adopt, streamed } from 'abide/runtime'
import { compile, describe, locate, originalPosition, ParseError } from 'abide/compiler'
import { renderToString } from 'abide/server'
import {
    container,
    duration,
    install,
    keep,
    measureFlush,
    nonZero,
    nsPerOp,
    sleep,
    suite,
    tick,
    until,
} from 'abide/tests'
import { mount } from 'abide/ui'
import Compiled, {
    count as compiledCount,
    filter as compiledFilter,
    search as compiledSearch,
    session as compiledSession,
} from '../counter.abide'
import { count, filter, search as handSearch, App as handWritten, session } from '../counter.ts'
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
                    '<p>${n}</p>',
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
                // Every member SPEC's "shared surface" lists, in one case: a verb, read or probe
                // missing from the reserved set desugars to a call on the VALUE — `s.dispose()`
                // became `s().dispose()`, which type-checks on anything with a `dispose` and is
                // wrong on everything else. One assertion so a member added to SPEC has one place
                // here to fail.
                for (const member of [
                    'set',
                    'invalidate',
                    'refresh',
                    'publish',
                    'dispose',
                    'peek',
                    'chunks',
                    'pending',
                    'refreshing',
                    'settled',
                    'done',
                    'streaming',
                    'error',
                    'isError',
                ]) {
                    is(
                        `\`${member}\` passes through`,
                        template(`<script>const s = state("ab")</script><p>{s.${member}()}</p>`),
                        `<p>\${() => s.${member}()}</p>`,
                    )
                }
                // A ternary's `:` and an object KEY's `:` are one token to a scanner, and the key
                // rule fired on both — so the consequent of every `a ? b : c` went unread. Silent
                // and worse than it looks: a cell is a function, so an unread one in a condition is
                // always truthy and the true arm always won.
                is(
                    'a ternary consequent is a READ, not an object key',
                    template('<script>const a = state(0)\nconst b = state(1)</script><p>{a ? b : a}</p>'),
                    '<p>${() => a() ? b() : a()}</p>',
                )
                is(
                    '…and an object key still is one',
                    template('<script>const a = state(0)</script><p>{ {source: a} }</p>'),
                    '<p>${() => ({source: a()})}</p>',
                )
                // An object literal reaching an arrow BODY has to be parenthesised, or the `{` opens
                // a BLOCK: `() => { a: cell }` is an arrow with a labelled statement that returns
                // undefined. It parses, so no parse check can see it — the slot rendered nothing,
                // the attribute went unset and the spread applied nothing, silently.
                is(
                    'an object literal in a slot is parenthesised',
                    template('<script>const a = state(0)</script><p>{ {k: a} }</p>'),
                    '<p>${() => ({k: a()})}</p>',
                )
                is(
                    '…in an attribute too',
                    template('<script>const a = state(0)</script><p title={{ k: a }}>x</p>'),
                    '<p title=${() => ({ k: a() })}>x</p>',
                )
                is(
                    '…and in a spread',
                    template('<script>const a = state(0)</script><div {...{ k: a }}>s</div>'),
                    '<div ...=${() => ({ k: a() })}>s</div>',
                )
                // The thunk above is kept because `a()` READS. A spread that reads nothing must lose
                // it: inside a `{#for}` an unconditional thunk cost a closure, a graph node and an
                // observer set per row for a wake that cannot happen — and a fresh closure per pass
                // also defeats the slot's `values[i] === previous[i]` cutoff. The emit stays valid
                // either way, so only an exact-emit assertion can see this.
                is(
                    'a spread that reads nothing is not thunked',
                    template('<script>const PLAIN = { k: 1 }</script><div {...PLAIN}>s</div>'),
                    '<div ...=${PLAIN}>s</div>',
                )
                is(
                    '…and a row property in a {#for} is not either',
                    template(
                        '<script>const rows = state([] as { attrs: object }[])</script>{#for row of rows}<li {...row.attrs}>s</li>{/for}',
                    ),
                    '${() => (rows() ?? []).map((row) => html`<li ...=${row.attrs}>s</li>`)}',
                )
                // Both arms of a ternary are EXPRESSIONS, so a `{` in one opens a literal. Read as a
                // block it made `k:` a label and the cell after it a type annotation.
                is(
                    'an object literal in a ternary arm is a literal',
                    template(
                        '<script>const a = state(0)\nconst f = state(true)</script><p>{f ? {k: a} : {k: a}}</p>',
                    ),
                    '<p>${() => f() ? {k: a()} : {k: a()}}</p>',
                )
                // An arrow with a BLOCK body is still a block, which is the case that would break if
                // the rule above were widened past a ternary's arms.
                is(
                    'a block body is still a block',
                    template(
                        '<script>const a = state(0)</script><p>{(() => { const v = a(); return v })()}</p>',
                    ),
                    '<p>${() => (() => { const v = a(); return v })()}</p>',
                )
                is(
                    'the explicit spelling still compiles',
                    template('<script>const n = state(0)</script><p>{n()}</p>'),
                    '<p>${() => n()}</p>',
                )
                // Whitespace is not part of an expression, and an `Expr` carries a POSITION as well
                // as text: `code()` slices the original file from it, so a source trimmed while its
                // start still pointed at the space came back short by that many characters —
                // `{#if  count > 10}` emitted `$0 > 1` and `{ n * 100 }` emitted `n() * 10`. Both
                // type-check, both render wrong, and every block header and attribute reached the
                // same way. One assertion per spelling that reads an expression out of a header.
                is(
                    'a doubled space in a hole',
                    template('<script>const n = state(0)</script><p>{ n * 100 }</p>'),
                    '<p>${() => n() * 100}</p>',
                )
                is(
                    '…in an {#if} header',
                    template('<script>const n = state(0)</script>{#if  n > 10}<b>x</b>{/if}'),
                    '${() => { const $0 = n(); if ($0 > 10) return html`<b>x</b>`; return null }}',
                )
                is(
                    '…in an {:else if} branch',
                    template('<script>const n = state(0)</script>{#if n > 1}a{:else if  n > 100}b{/if}'),
                    '${() => { const $0 = n(); if ($0 > 1) return html`a`; if ($0 > 100) return html`b`; return null }}',
                )
                is(
                    '…in a {#for} header and its `by`',
                    template('{#for  x of xs by  x.id}<li>{x}</li>{/for}'),
                    '${() => (xs ?? []).map((x) => keyed(x.id, html`<li>${x}</li>`))}',
                )
                is(
                    '…in an attribute',
                    template('<script>const n = state(0)</script><div data-x={ n * 100 }></div>'),
                    '<div data-x=${() => n() * 100}></div>',
                )
                is(
                    '…and in a hole inside a quoted one',
                    template('<script>const n = state(0)</script><div class="a { n * 100 } b"></div>'),
                    '<div class=${() => `a ${n() * 100} b`}></div>',
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
                    '<ul>${() => (xs ?? []).map((count) => html`<li>${count}</li>`)}</ul>',
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
            note: '`class` is a single attribute however many toggles it carries, so the static value and every toggle are handed to one `classes()` call. The toggle NAMES are static, so they are lifted to module scope as one shared array and only the conditions travel per wake — a class list is rebuilt on every wake of the element’s binding, and on a row of a list that is per row. On a component the same syntax is a compile error — there is no element to toggle a class on.',
            run({ is, throws }) {
                is(
                    'static plus two toggles',
                    template(
                        '<script>const n = state(3)</script><p class="card" class:high={n > 2} class:low={n <= 2}>x</p>',
                    ),
                    '<p class=${() => classes("card", $lifted0, n() > 2, n() <= 2)}>x</p>',
                )
                is(
                    'a style property',
                    template('<script>const w = state(1)</script><p style:width={w}>x</p>'),
                    '<p style=${() => styles("", $lifted0, w())}>x</p>',
                )
                // A toggle whose condition reads nothing live loses its thunk, like every other
                // attribute in the same loop: inside a `{#for}` that was a closure, a graph node and
                // its observer set per row for a wake that cannot happen.
                is(
                    'a toggle over a loop binding gets no thunk',
                    template('{#for row of rows}<b class:on={row.flag}>x</b>{/for}'),
                    '${() => (rows ?? []).map((row) => html`<b class=${classes("", $lifted0, row.flag)}>x</b>`)}',
                )
                is(
                    'the names are hoisted, and two elements toggling the same names share one array',
                    compile(
                        '<script>const n = state(3)</script><p class:big={n > 2}>x</p><i class:big={n < 1}>y</i>',
                        { filename: 'C.abide' },
                    ).code.includes('const $lifted0 = ["big"]'),
                    true,
                )
                throws('class: on a component', () => template('<Card class:big={true}/>'), 'component')
            },
        },

        {
            title: 'bind:value is a read AND a write, so it compiles to two slots',
            note: 'One spelling, two bindings on the same element: a property slot for the value and a listener that writes back. The value slot is handed the CELL, not a thunk that reads it — `unwrap` reads a slot’s source one step further, so the two write the same thing and the thunk was a fresh closure per bound input per row. The arms that cannot do that are the ones with something to compute: an accessor pair is not a cell, `bind:checked` needs `!!` for the attribute half, and `bind:group` compares against the input’s own value. A `<select>` needs no arm at all — `.value` plus a `change` listener IS the default one — so a selection is bound there and each `<option>` carries a plain `value="…"`. The listener carries the element’s own type, because the emitted file is type-checked like any other — an untyped `event` there is an implicit `any` in the author’s build. `bind:checked` also emits the boolean ATTRIBUTE, so the state survives SSR.',
            async run({ is, throws }) {
                is(
                    'value',
                    template('<script>const f = state("")</script><input bind:value={f} />'),
                    '<input .value=${f} @input=${(event: Event) => f.set((event.currentTarget as HTMLInputElement).value)} />',
                )
                is(
                    'checked mirrors an attribute too',
                    template('<script>const on = state(true)</script><input bind:checked={on} />'),
                    '<input .checked=${() => !!on()} checked=${() => !!on()} @change=${(event: Event) => on.set((event.currentTarget as HTMLInputElement).checked)} />',
                )

                // A select needs no arm of its own: `.value` plus the `change` listener IS the
                // default arm, and the option carries a plain attribute.
                is(
                    'a select binds through value, and its options are plain attributes',
                    template(
                        '<script>const chosen = state("a")</script><select bind:value={chosen}><option value="a">A</option></select>',
                    ),
                    '<select .value=${chosen} @change=${(event: Event) => chosen.set((event.currentTarget as HTMLSelectElement).value)}><option value="a">A</option></select>',
                )
                throws(
                    'bind:selected is refused, and names the spelling that works',
                    () =>
                        template(
                            '<script>const chosen = state("a")</script><option bind:selected={chosen}>A</option>',
                        ),
                    'bind:value',
                )

                // `group` is membership, so both halves have something to compute — and each reads
                // the cell ONCE into a local. `sources` has no dedupe, so a thunk reading it twice
                // subscribed the slot's effect twice, and a group is N inputs on one cell.
                is(
                    'group reads the cell once per half',
                    template(
                        '<script>const many = state([])</script><input type="checkbox" value="x" bind:group={many} />',
                    ),
                    '<input type="checkbox" value="x" .checked=${() => { const held = many(); return Array.isArray(held) ? held.includes("x") : held === "x" }}' +
                        ' @change=${(event: Event) => { const held = many(); many.set(Array.isArray(held) ? ((event.currentTarget as HTMLInputElement).checked ? [...held, "x"] : held.filter((v: unknown) => v !== "x")) : "x") }} />',
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
            title: '{await value} is the short form of {#await value then v}{v}{/await}',
            note: 'The shortest await there is: no arms, so the settled value IS the body. It compiles to the same `awaited()` call the long form does, with an identity `then` — which means it inherits what the long form means rather than being a second mechanism. In particular it has NO PENDING ARM, and that is what decides a server render BLOCKS on it and writes complete markup: there is nothing to send early, so nothing is deferred and a reader running no scripts still has the content. Adding a `{:pending}` arm is how the other lane is asked for. It used to compile to `() => await value` — a thunk is not async, so that was JavaScript no engine parses, produced silently, with the error arriving from the runtime and nothing pointing back at the line.',
            run({ is, throws }) {
                const short = template('<script>const cell = state(0)</script><p>{await cell}</p>')
                is(
                    'no pending arm, and the settled value is the body',
                    short,
                    '<p>${() => awaited(cell, { pending: undefined, then: (_awaited) => _awaited, catch: undefined, finally: undefined })}</p>',
                )
                // The same call the long form makes, which is the claim that it is one mechanism.
                is(
                    'the long form differs only in what the arm renders',
                    template('<script>const cell = state(0)</script><p>{#await cell then c}{c}{/await}</p>'),
                    '<p>${() => awaited(cell, { pending: undefined, then: (c) => html`${c}`, catch: undefined, finally: undefined })}</p>',
                )
                // The operand is the CELL, not a read of it: awaiting `cell()` would await whatever
                // is there NOW, which for a load that has not landed is `undefined`.
                is('the operand is the cell itself', short.includes('awaited(cell,'), true)
                // A name that merely starts with the letters is not an await.
                is('`awaitable` is an identifier', template('<p>{awaitable}</p>'), '<p>${awaitable}</p>')

                // Awaiting a value and then reaching INTO it, which is the shape a cell actually
                // wants. Liftable because both halves are CONTIGUOUS in the file — the operand
                // inside the parentheses and the suffix after them — and that is the whole of what
                // limits it, since desugaring works on file offsets and cannot see substituted text.
                is(
                    'the suffix after (await x) becomes the arm',
                    template('<script>const user = state(0)</script><p>{(await user).profile.name}</p>'),
                    '<p>${() => awaited(user, { pending: undefined, then: (_awaited) => _awaited.profile.name, catch: undefined, finally: undefined })}</p>',
                )
                // …and the suffix is ordinary template code, so a cell read in it still desugars.
                is(
                    'a cell read inside the suffix',
                    template('<script>const user = state(0)\nconst key = state("a")</script><p>{(await user).items[key]}</p>'),
                    '<p>${() => awaited(user, { pending: undefined, then: (_awaited) => _awaited.items[key()], catch: undefined, finally: undefined })}</p>',
                )
                // `await a.b.c` is `await (a.b.c)` in JavaScript and stays that: the operand is the
                // whole chain, so a cell is READ before it has landed. That compiles and throws at
                // render, and it is the author's expression — abide does not second-guess it.
                is(
                    'await binds looser than member access, as in JavaScript',
                    template('<script>const user = state(0)</script><p>{await user.profile.name}</p>').includes(
                        'awaited(user().profile.name,',
                    ),
                    true,
                )
                // Two operands and one arm is not a shape this can be. `{#await}` nests.
                throws(
                    'two awaits in one slot',
                    () => template('<p>{(await a).x + (await b).y}</p>'),
                    'only the whole expression',
                )

                // WHICH FORM, not whether the pending body is blank. `{#await p}{:then v}` with
                // nothing before the branch is what an author writes to narrow in `{:then}`, or to
                // stream one block with no placeholder — so it emits a pending arm and DEFERS. The
                // compact forms have none by construction and block. Deciding on emptiness instead
                // would make a stray space the difference between holding a response and streaming
                // it, which is not a thing a reader of the file could see.
                const pendingOf = (source: string): string =>
                    /pending: ([^,]+)/.exec(template(source))?.[1] ?? 'none'
                is('the block form, empty', pendingOf('<p>{#await p()}{:then v}{v}{/await}</p>'), '() => null')
                is(
                    'the block form, with a placeholder',
                    pendingOf('<p>{#await p()}<em>x</em>{:then v}{v}{/await}</p>'),
                    '() => html`<em>x</em>`',
                )
                is('the compact form', pendingOf('<p>{#await p() then v}{v}{/await}</p>'), 'undefined')
                is('the short slot form', pendingOf('<p>{await p()}</p>'), 'undefined')
                // And the one shape there is no rewrite for: a thunk with an await buried in it is
                // not expressible as any arrangement of `{#await}`, so it is refused on the line
                // rather than emitted as source no engine parses.
                throws(
                    'an await that is not the whole expression',
                    () => template('<p>{x ? await a : b}</p>'),
                    'the whole expression',
                )
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
                    '<ul>${() => (ws ?? []).map((w) => keyed(w, html`<li>${w}</li>`))}</ul>',
                )
                is(
                    'keyless is positional',
                    template('<ul>{#for w, i of ws}<li>{i}</li>{/for}</ul>'),
                    '<ul>${() => (ws ?? []).map((w, i) => html`<li>${i}</li>`)}</ul>',
                )
            },
        },

        {
            title: 'a block body does not carry the source’s own indentation into every row',
            note: 'A block written across lines opens with the newline and indent before its first node and closes with the indent before `{/for}`. Left in, those are two static text nodes PER ITERATION and they join the row’s movable range, so a keyed reorder relocates them alongside the row and a 500-row list pays for them 500 times. Nothing about the rendered page says so — this is the shape claim; what it costs is the client suite’s per-row node count. Only whitespace CARRYING A NEWLINE is taken, and only at the two ends: a space written deliberately between two inline nodes on one line is content, and it is the one thing this would otherwise change the layout of.',
            run({ is }) {
                is(
                    'a row is the row, with nothing either side of it',
                    template(
                        '<ul>\n    {#for w of ws by w.id}\n        <li>{w.label}</li>\n    {/for}\n</ul>',
                    ),
                    '<ul>\n    ${() => (ws ?? []).map((w) => keyed(w.id, html`<li>${w.label}</li>`))}</ul>',
                )
                // The exception, and the reason the test is for a NEWLINE rather than for whitespace.
                is(
                    'a deliberate inline space inside a body survives',
                    template('<p>{#if a}<b>x</b> <i>y</i>{/if}</p>'),
                    '<p>${() => a ? html`<b>x</b> <i>y</i>` : null}</p>',
                )
                // Only the body's ENDS are trimmed, so text between two nodes is left alone whatever
                // it holds — the run being removed is the one the author never wrote as content.
                is(
                    'and so does the break BETWEEN two nodes of one row',
                    template(
                        '<ul>\n    {#for w of ws}\n        <li>{w}</li>\n        <li>x</li>\n    {/for}\n</ul>',
                    ),
                    '<ul>\n    ${() => (ws ?? []).map((w) => html`<li>${w}</li>\n        <li>x</li>`)}</ul>',
                )
                // Whitespace outside a body is not the body's, which is what keeps the ordinary
                // shape — a block on its own lines with text around it — spaced as it was written.
                is(
                    'whitespace around the block is untouched',
                    template('<p>before {#if a}<b>x</b>{/if} after</p>'),
                    '<p>before ${() => a ? html`<b>x</b>` : null} after</p>',
                )
                // The trim has to see PAST a doc comment to the newline behind it: the emitter drops
                // the comment, so a boundary the two disagreed about leaves a stray text node in
                // every row that neither file looks like it produced.
                is(
                    'a comment on its own line does not hold the indent in',
                    template(
                        '<ul>\n    {#for w of ws}\n        <!-- the row -->\n        <li>{w}</li>\n    {/for}\n</ul>',
                    ),
                    '<ul>\n    ${() => (ws ?? []).map((w) => html`<li>${w}</li>`)}</ul>',
                )
            },
        },

        {
            title: 'a hole that cannot READ gets no thunk',
            note: 'A thunk is the reactivity convention, and on the client it costs a closure per instance AND an effect node per slot — plus, being fresh every time, it defeats the identity cutoff that skips an unchanged row. So a hole whose emitted form CANNOT evaluate anything gets none, whatever its shape: every read this compiler emits is a call, so a call-free expression reads no source. The test is on what the emit PRODUCED, not on what was written — a cell in a child slot comes back as `count` and a cell in an attribute comes back as `count()`, so one rule answers both positions. Call-free is the load-bearing half: `{helper()}` may read a cell and nothing about the expression says so. A function literal is excluded for a different reason — a function reaching a slot is DATA the binder would call, so leaving one bare would change what it MEANS, not when it runs.',
            run({ is }) {
                const cell = '<script>const n = state(0)</script>'

                // The cases that keep it, and WHY each one has to.
                is('a read is a read', template(`${cell}<p>{n + 1}</p>`), '<p>${() => n() + 1}</p>')
                is(
                    'a call could read anything',
                    template(`${cell}<p>{helper()}</p>`),
                    '<p>${() => helper()}</p>',
                )
                is(
                    'a path OFF a cell is a read',
                    template('<script>const s = state({ a: 1 })</script><p>{s.a}</p>'),
                    '<p>${() => s().a}</p>',
                )

                // …and the cases that drop it.
                is('a cell named alone in a slot', template(`${cell}<p>{n}</p>`), '<p>${n}</p>')
                is(
                    'a path rooted at an ordinary binding',
                    template('<ul>{#for item of xs}<li>{item.id}</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((item) => html`<li>${item.id}</li>`)}</ul>',
                )
                is(
                    'a branch-local const',
                    template('<ul>{#for x of xs}<script>const w = x * 2</script><li>{w}</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((x) => {\nconst w = x * 2\nreturn html`<li>${w}</li>` })}</ul>',
                )

                // Call-free is the rule, not "is a plain path": these compose a loop binding into
                // something bigger and still read nothing, so a thunk here bought an effect per row
                // that can never wake — and, being a fresh closure, stopped the row being skipped.
                is(
                    'an index into a static table, over a loop binding',
                    template('<ul>{#for item of xs}<li>{TONE[item.kind]}</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((item) => html`<li>${TONE[item.kind]}</li>`)}</ul>',
                )
                is(
                    'a ternary over one',
                    template('<ul>{#for item of xs}<li>{item.a === "" ? " " : item.a}</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((item) => html`<li>${item.a === "" ? " " : item.a}</li>`)}</ul>',
                )
                // …but a FUNCTION is data the binder would call, so it keeps its thunk.
                is('a function literal keeps it', template('<p>{(x) => x}</p>'), '<p>${() => (x) => x}</p>')

                // An ATTRIBUTE was handed the read rather than the cell, so the same name keeps its
                // thunk there. This is the pair that would break if the rule looked at the SOURCE.
                is(
                    'the same cell in an attribute is a call, so it stays',
                    template(`${cell}<p title={n}>x</p>`),
                    '<p title=${() => n()}>x</p>',
                )
                is(
                    '…and a static one there drops it too',
                    template('<ul>{#for item of xs}<li class={item.kind}>x</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((item) => html`<li class=${item.kind}>x</li>`)}</ul>',
                )

                // One live hole is enough to make the joined string move.
                is(
                    'an interpolated attribute — every hole static',
                    template('<ul>{#for item of xs}<li class="row {item.kind}">x</li>{/for}</ul>'),
                    '<ul>${() => (xs ?? []).map((item) => html`<li class=${`row ${item.kind}`}>x</li>`)}</ul>',
                )
                is(
                    '…and one that is not',
                    template(`${cell}<p class="row {n}">x</p>`),
                    '<p class=${() => `row ${n()}`}>x</p>',
                )
            },
        },

        {
            title: 'components: a tag is a call, children are a prop, {#component} is a value',
            note: 'A capitalised tag invokes; `<slot/>` renders what was passed — through whatever name the enclosing parameter list bound it under, which for an inline `{#component X(props)}` is `props` and not the outer component’s `args`. A nested `{#component X()}` inside a component’s children becomes that component’s `X` prop, which is how a render-prop is spelled without a second concept.',
            run({ is, throws }) {
                is(
                    'invocation with props',
                    template('<Card title="hi" n={1}/>'),
                    '${() => Card({ title: "hi", n: 1, children: undefined })}',
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
                    '${() => Card({ onclick: go, children: undefined })}',
                )
                is(
                    'slot renders the children — UNTHUNKED, since the caller built them eagerly',
                    template('<div><slot/></div>'),
                    '<div>${args.children}</div>',
                )
                // …and inside an inline component it reaches THAT component's parameter. Emitting
                // `args.children` there read past it to the enclosing component: the passed children
                // were dropped and the parent's rendered instead, and the declared prop type carries
                // `children`, so it type-checked.
                is(
                    'an inline component names its own parameter',
                    compile(
                        '{#component Row(props: { children?: unknown })}[<slot/>]{/component}<Row><b>S</b></Row>',
                        { filename: 'C.abide' },
                    ).code.includes('(props: { children?: unknown }) => html`[${props.children}]`'),
                    true,
                )
                is(
                    '…and a destructured one reaches the binding',
                    compile(
                        '{#component Row({ children }: { children?: unknown })}[<slot/>]{/component}<Row><b>S</b></Row>',
                        { filename: 'C.abide' },
                    ).code.includes('({ children }: { children?: unknown }) => html`[${children}]`'),
                    true,
                )
                throws(
                    'a pattern that binds no children says so, instead of reading the parent’s',
                    () =>
                        compile('{#component Row({ n }: { n: number })}[<slot/>]{/component}<Row n={1}/>', {
                            filename: 'C.abide',
                        }),
                    'no children to render',
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
            title: 'counter.abide and counter.ts render identically, on both substrates',
            note: 'The parity claim, and the whole point: `counter.ts` is the hand-written arm — the file someone would actually write — and `counter.abide` is the same component in the sugared spelling. Same markup from the server, same DOM from the client. A difference here means the compiler is not emitting what a person would.',
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
                        label: 'vanilla — the hand-written counter.ts, one count write',
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
                    code.includes('if ($0) return html`${$0.pages} pages`'),
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
            title: 'which SPELLING declares a source, and which one declares a keyed one',
            note: 'Both questions are answered syntactically, at the declaration, because the emit path must not need a type-checker. `state.shared(key, …)` is `state` with an address in front of the value, so the binding is a cell. `channel<T, Args>()` has no body to read a parameter off, so the second TYPE ARGUMENT is the declaration — and a comma nested inside one type is not a second type.',
            async run({ is }) {
                const shared = template(
                    "<script>const theme = state.shared('theme', 'dark')</script><p>{theme.length}</p>",
                )
                is('state.shared declares a cell', shared.includes('${() => theme().length}'), true)
                is(
                    '…and it is written by name too',
                    template(
                        "<script>const theme = state.shared('theme', 'dark')</script>" +
                            "<button onclick={() => { theme = 'light' }}>x</button>",
                    ).includes("theme.set('light')"),
                    true,
                )

                const rooms = template(
                    '<script>const chat = channel<string, { room: string }>()</script>' +
                        "<p>{chat({ room: 'a' }) + '!'}</p>",
                )
                is('a room is read by its CALL', rooms.includes("chat({ room: 'a' })() + '!'"), true)
                is(
                    '…and named alone it hands over the room itself',
                    template(
                        '<script>const chat = channel<string, { room: string }>()</script>' +
                            "<p>{chat({ room: 'a' })}</p>",
                    ).includes("${() => chat({ room: 'a' })}"),
                    true,
                )
                // The depth rule: `Map<string, number>` is ONE type argument, not two.
                is(
                    'a comma inside a type argument does not make it a room',
                    template(
                        '<script>const wide = channel<Map<string, number>>()</script><p>{wide.size}</p>',
                    ).includes('${() => wide().size}'),
                    true,
                )

                // The other door to the same answer: a prop's TYPE says which of the two it is, and
                // the BINDING says what it is called here. Nothing resolves the import, so the names
                // in that set are the whole test — a type of an app's own that happens to be called
                // `KeyedChannel` would be read as this one.
                const declared = (members: string, bound: string): string =>
                    `<script>\nimport { props } from 'abide'\ntype Props = {\n${members}\n}\nconst { ${bound} } = props<Props>()\n</script>`
                is(
                    'a prop typed as rooms is read by its CALL',
                    template(
                        `${declared('    chat: KeyedChannel<{ room: string }, string>', 'chat')}` +
                            `<p>{chat({ room: 'a' }).length}</p>`,
                    ).includes("chat({ room: 'a' })().length"),
                    true,
                )
                is(
                    '…where one typed as a cell is read by its NAME',
                    template(`${declared('    note: State<string>', 'note')}<p>{note.length}</p>`).includes(
                        '${() => note().length}',
                    ),
                    true,
                )
                // The rename, which is the reason the two facts have to MEET. Read off the declared
                // type alone, the cell was still called `note` and `text` stayed a plain value — so
                // `text.length` emitted a function's arity, which type-checks and renders `0`.
                is(
                    'a renamed cell prop follows the LOCAL name',
                    template(
                        `${declared('    note: State<string>', 'note: text')}<p>{text.length}</p>`,
                    ).includes('${() => text().length}'),
                    true,
                )
                is(
                    '…and the name it was renamed FROM is nobody',
                    template(
                        `${declared('    note: State<string>', 'note: text')}<p>{text.length}</p>`,
                    ).includes('note()'),
                    false,
                )
                // `props()` is the parameter, so the call is erased and the import goes with it. The
                // whole module rather than the template: this claim is about what surrounds it.
                const erased = compile(`${declared('    note: State<string>', 'note')}<p>{note.length}</p>`, {
                    filename: 'Case.abide',
                }).code
                is('the call becomes the parameter', erased.includes('const { note } = args'), true)
                is('…and `props` is not imported by what was emitted', erased.includes('props'), false)
            },
        },

        {
            title: 'a comment in the markup is for the file, not for the wire',
            note: "A component ships one copy of its own commentary per INSTANCE, and a file header is the biggest comment it has: the example's card and source panes were 22.7 kB of a single 88 kB page that way, against 1.9 kB for every hydration marker on it. Dropping them at emit rather than at parse keeps `check` pointing a diagnostic at what a human wrote, and dropping them ONCE is what keeps the two lanes agreeing — both substrates read this one template, so a comment absent from the client's markup is absent from the server's. Whitespace is left exactly as it was, because the space between two inline elements is content and a comment sitting in it is not.",
            async run({ is, throws }) {
                is(
                    'a header comment leaves nothing behind',
                    template('<!-- gone -->\n<p>hi</p>'),
                    '<p>hi</p>',
                )
                is(
                    'and one between two elements takes only itself',
                    template('<p><b>a</b> <!-- note --> <i>b</i></p>'),
                    '<p><b>a</b>  <i>b</i></p>',
                )
                // The one that would be a rendering change rather than a saving: two inline elements
                // separated by a single space are separated by a single space afterwards.
                is(
                    'an inline space is untouched',
                    template('<p><b>a</b> <i>b</i></p>'),
                    '<p><b>a</b> <i>b</i></p>',
                )

                // An ATTRIBUTE value is not markup, and `<!--` in one is four characters of the value.
                is(
                    'a comment-looking attribute value survives whole',
                    template('<p title="use <!-- --> with care">x</p>'),
                    '<p title="use <!-- --> with care">x</p>',
                )

                // A comment is not MARKUP either, which is a separate claim from not being output —
                // the block depth is counted on raw text BEFORE anything is parsed, to decide which
                // `<script>` is top-level, and that count used to read straight through a comment.
                // So a file whose header described the syntax opened a block nobody wrote, and the
                // `<script module>` under it was refused as nested. Found by writing exactly that
                // sentence in `pages/streaming`, which is the file this whole mechanism is for.
                is(
                    'a block marker inside a comment opens nothing',
                    compile('<!-- an {#await} with a {:pending} arm -->\n<script module>\nconst A = 1\n</script>\n<p>ok</p>\n', {
                        filename: 'C.abide',
                    }).code.includes('const A = 1'),
                    true,
                )
                // …and the refusal it was drowning out still fires, so this is not the check removed.
                throws(
                    'a script module really nested in a branch is still refused',
                    () => compile('{#if x}<script module>\nconst A = 1\n</script>{/if}\n', { filename: 'C.abide' }),
                    'module scope',
                )

                // And the escape hatch SPEC names, for a comment that really has to reach a browser.
                is(
                    '`{html(…)}` still emits one',
                    template("<p>{html('<!-- kept -->')}</p>").includes('raw('),
                    true,
                )
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
                    '<p>${() => { const $0 = s(); if ($0) return html`${$0}`; return null }}</p>',
                )
                is(
                    'a keyed call is hoisted WHOLE, arguments and all',
                    body('<p>{#if m({ id: 1 })}{m({ id: 1 })}{/if}</p>'),
                    '<p>${() => { const $0 = m({ id: 1 })(); if ($0) return html`${$0}`; return null }}</p>',
                )
                is(
                    'an else-if is still lazy — its read only runs when the first misses',
                    body('<p>{#if s}a{:else if m({ id: 2 })}b{/if}</p>').includes(
                        'if ($0) return html`a`; const $1 = m({ id: 2 })()',
                    ),
                    true,
                )
                // …and an arm that repeats the FIRST arm's read collapses onto its local instead of
                // taking a second one. Two locals meant two subscriptions to one cell on a `sources`
                // list that does not dedupe, so every later re-run of the slot walked both and did an
                // `observers.delete` that misses. Right output, twice the work — see SPEC's
                // "narrowing".
                is(
                    'a repeated read across arms is ONE local',
                    body('<p>{#if s > 1}a{:else if s > 2}b{/if}</p>'),
                    '<p>${() => { const $0 = s(); if ($0 > 1) return html`a`; if ($0 > 2) return html`b`; return null }}</p>',
                )
                // The switch subject is bound once WHATEVER it is, so the explicit spelling costs
                // what the sugar costs — the sugar is over the explicit form, never instead of it.
                // A subject or a case value that is not atomic goes in as an OPERAND. Pasted bare,
                // `{#switch a ?? b}` emitted `a ?? b === 'x' ? … : …`, which JavaScript reads as
                // `a ?? (b === 'x')` — the wrong branch, no error, and nothing a type-check sees.
                is(
                    'a loose subject is bound, not pasted into every arm',
                    body('<p>{#switch s ?? 0}{:case 0}a{:default}b{/switch}</p>'),
                    '<p>${() => { const $0 = s(); const $1 = $0 ?? 0; return $1 === 0 ? html`a` : html`b` }}</p>',
                )
                is(
                    'a loose case value is parenthesised',
                    body('<p>{#switch k}{:case alt ? 1 : 2}a{:default}b{/switch}</p>'),
                    '<p>${() => k === (alt ? 1 : 2) ? html`a` : html`b`}</p>',
                )
                is(
                    '…and a loose {#if} condition is too, since the ternary would swallow it',
                    body('<p>{#if a ?? b}x{:else}y{/if}</p>'),
                    '<p>${() => (a ?? b) ? html`x` : html`y`}</p>',
                )
                // A call already binds tighter than what it is pasted beside, so it is left alone.
                is(
                    'a call needs none of that',
                    body('<p>{#if risky()}x{:else}y{/if}</p>'),
                    '<p>${() => risky() ? html`x` : html`y`}</p>',
                )
                is(
                    'the explicit switch spelling reads once, like the sugared one',
                    body('<p>{#switch s()}{:case 1}a{:default}b{/switch}</p>'),
                    body('<p>{#switch s}{:case 1}a{:default}b{/switch}</p>'),
                )
                is(
                    '…and that is one read for the whole chain',
                    body('<p>{#switch s()}{:case 1}a{:case 2}b{:default}c{/switch}</p>'),
                    '<p>${() => { const $0 = s(); return $0 === 1 ? html`a` : $0 === 2 ? html`b` : html`c` }}</p>',
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
                    body('<p>{#if s}{other}{/if}</p>').includes('html`${other}`'),
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
            title: 'a nested <style> scopes a SUBTREE, and an element carries every scope in force',
            note: "The subtree form is the same machine as the component form pointed at fewer elements: one more `data-a<hash>` on the nodes the block sits among, and their descendants. That is what makes the containment asymmetric on purpose — an outer selector still matches inside, because the outer attribute is on every element the component writes; an inner one cannot match outside, because the inner attribute is only on the subtree. Blocks are content-addressed, so a nested block spelling exactly the outer block's rules is the SAME scope and is not written onto the tag twice.",
            async run({ is }) {
                const emitted = compile(
                    '<main><p>outer</p>{#if on}<style>p { color: blue }</style><p>inner</p>{/if}</main>' +
                        '\n<style>p { color: red }</style>',
                    { filename: 'Nested.abide' },
                ).code
                const scopes = [...emitted.matchAll(/adopt\('(\w+)'/g)].map((m) => `data-a${m[1]}`)
                const [outer, inner] = scopes as [string, string]

                is('both blocks registered', scopes.length, 2)
                is('the component block goes first', emitted.indexOf(outer) < emitted.indexOf(inner), true)
                is('an element outside carries the outer scope alone', emitted.includes(`<p ${outer}>`), true)
                is('one inside carries both', emitted.includes(`<p ${outer} ${inner}>`), true)
                is(
                    'and the enclosing element is NOT in the subtree',
                    emitted.includes(`<main ${outer}>`),
                    true,
                )
                is(
                    'each block requires its own attribute',
                    emitted.includes(`p[${outer}] { color: red }`),
                    true,
                )
                is('…including the nested one', emitted.includes(`p[${inner}] { color: blue }`), true)

                // Content-addressed: the same rules are the same sheet, so the attribute is already
                // in force and a second copy of it in the tag would be a duplicate attribute.
                const same = compile(
                    '<main>{#if on}<style>p { color: red }</style><p>x</p>{/if}</main>\n<style>p { color: red }</style>',
                    {
                        filename: 'Same.abide',
                    },
                ).code
                is(
                    'a nested block repeating the outer rules is one sheet',
                    [...same.matchAll(/adopt\(/g)].length,
                    1,
                )
                is('and is not written onto the tag twice', /<p (data-a\w+) \1>/.test(same), false)
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
                // Stamped like the real thing. This element stands in for one the SERVER wrote, and a
                // server under a policy writes it with a nonce — a bare one is refused, which is a
                // console error on a passing case and furniture that lies about what it imitates.
                const stamp = (document.querySelector('style[data-abide]') as HTMLElement | null)?.nonce
                if (stamp !== undefined && stamp !== '') served.nonce = stamp
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
                        'awaited(p, { pending: () => html`a`, then: (v) => html`b`, catch: (e) => html`c`, finally: undefined })',
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
                await until(() => rows().length === 3, 'three rows', STREAM_BUDGET_MS)
                is('rows arrive as they are yielded', rows(), ['lobby 1', 'lobby 2', 'lobby 3'])

                room.set('bad')
                await until(
                    () => rows().some((line) => line?.startsWith('bad') === true),
                    'the new source',
                    STREAM_BUDGET_MS,
                )
                is(
                    'a new source starts over, it does not interleave',
                    rows().filter((line) => line?.startsWith('lobby') === true),
                    [],
                )

                await until(() => rows()[0] === 'Error: stream failed', 'the {:catch} row', STREAM_BUDGET_MS)
                is('and {:catch} takes a source that threw', rows(), ['Error: stream failed'])
                host.remove()
            },
        },

        {
            title: 'a streamed row costs one row, however many are already there',
            note: 'The case above proves rows ARRIVE; three of them cannot tell an append from a rebuild, because both put the same text on screen. This one streams two sizes and compares how the per-row cost grows against the same rows appended by hand. A stream used to hand its whole accumulated array to `ListPart.set`, which reconciles the LIST — so row 400 re-probed and re-updated the 399 already placed, and the quadratic was invisible because every one of those updates correctly wrote nothing.',
            async run({ is, log }) {
                // How the per-row cost GROWS between two sizes of the same structure, over the same
                // growth measured by hand — a ratio of ratios, which is the form of this claim that
                // stays honest across substrates. An absolute number here would describe the machine
                // and the DOM emulator, not the reconcile.
                const streamRows = async (count: number): Promise<number> => {
                    const host = container()
                    // The source SIGNALS its own end, and nothing here polls. `until` sleeps 2 ms a
                    // turn, which is a floor the small arm spends most of its time under — with it
                    // in the loop this case reported ~1x for the rebuild it was written to catch.
                    let done!: () => void
                    const finished = new Promise<void>((resolve) => {
                        done = resolve
                    })
                    // No timer in the source either: what is measured is the per-row work, and a
                    // yield interval would swamp it. The rows are placed synchronously inside the
                    // consuming loop, so everything is on screen by the time this resolves.
                    const source = async function* (): AsyncGenerator<number> {
                        for (let i = 0; i < count; i++) yield i
                        done()
                    }
                    const mounted = mount(
                        host,
                        () => html`<ul>${() => streamed(source(), (n) => html`<li>${n}</li>`)}</ul>`,
                    )
                    await finished
                    const landed = host.querySelectorAll('li').length
                    // Disposed, not just detached: this runs thousands of times inside the batch
                    // below, and a scope left standing per op would make the later passes measure
                    // the accumulation rather than the stream.
                    mounted.dispose()
                    host.remove()
                    return landed
                }

                is('64 rows landed', await streamRows(64), 64)
                is('2048 rows landed', await streamRows(2048), 2048)

                // The same rows appended by hand, out of the same async source — and it is here to
                // absorb the substrate rather than to win: a longer parent costs more to append to
                // in any DOM, so BOTH arms grow with the list, and only the growth abide adds ON TOP
                // of the hand-written arm's is a claim about the reconcile. Against a fixed bound
                // instead, abide's own growth reads 1.44x under Bun's DOM and 0.89x in Safari, which
                // is a bound that would have to straddle the substrate rather than measure the code.
                const byHand = async (count: number): Promise<number> => {
                    const host = container()
                    const list = document.createElement('ul')
                    host.append(list)
                    const source = async function* (): AsyncGenerator<number> {
                        for (let i = 0; i < count; i++) yield i
                    }
                    for await (const n of source()) {
                        const li = document.createElement('li')
                        li.textContent = String(n)
                        list.append(li)
                    }
                    const landed = list.children.length
                    host.remove()
                    return landed
                }

                is('and the hand-written arm lands them too', await byHand(64), 64)

                // Timed by `nsPerOp` rather than by a clock around one run, and that is what makes
                // the case portable: Safari clamps `performance.now` to 1 ms, one 64-row stream
                // lands well inside a quantum, so the small arm read 0 and the ratio came out
                // `Infinity` — a fact about the clock, not about the reconcile. Sizing the batch to
                // 40 ms also warms the JIT, which is what makes the arms DISTINGUISH at all:
                // measured cold, the small arm carries the warmup and reads as slow, which
                // flattered the rebuild this case was written to catch.
                const [fewStreamed, manyStreamed, fewByHand, manyByHand] = (await nsPerOp([
                    { label: '64 rows', run: () => streamRows(64) },
                    { label: '2048 rows', run: () => streamRows(2048) },
                    { label: '64 rows by hand', run: () => byHand(64) },
                    { label: '2048 rows by hand', run: () => byHand(2048) },
                ])) as [number, number, number, number]

                const growth = (few: number, many: number): number => many / 2048 / (few / 64)
                const ratio = growth(fewStreamed, manyStreamed) / growth(fewByHand, manyByHand)
                log(
                    'per row',
                    `64 rows — ${duration(fewStreamed / 64)}, 2048 — ${duration(manyStreamed / 2048)}`,
                )
                log(
                    'per row, by hand',
                    `64 rows — ${duration(fewByHand / 64)}, 2048 — ${duration(manyByHand / 2048)}`,
                )
                // 32x the rows. Appending, abide grows with the list exactly as far as the DOM under
                // it does and this measures ~1.2x; the accumulated-array rebuild this case was
                // written to catch grows 12x where the hand-written arm grows 1.2x, so the same
                // number reads ~10x. The bound sits between them with 2.5x of room below and 3x
                // above, because a clock in a browser card is loose — what it has to separate is a
                // flat cost from a growing one.
                is(`32x the rows costs no more per row than by hand (${ratio.toFixed(2)}x)`, ratio < 3, true)
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
                    emitted.includes(
                        'boundary(() => html`${risky()}`, { pending: undefined, then: undefined, catch: (e) => html`bad`, finally: undefined })',
                    ),
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
                    emitted.includes('(x) => {\nconst n = x * 2\nreturn html`<li>${n}</li>`'),
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
                // The same rule one level down, and the case that used to pass SILENTLY: a script
                // nested inside an element is invisible to the walk that takes a body's leading one,
                // so its declarations were dropped while every use of them stayed in the markup —
                // a file that emits and then fails on a name nothing declared.
                throws(
                    'nested inside an element is the same error',
                    () => compile('{#if 1 > 0}<div><script>const a = 1</script><p>{a}</p></div>{/if}'),
                    'nested inside an element',
                )
                throws(
                    'and carries no import',
                    () => compile("<ul>{#for x of xs}<script>import { y } from 'z'</script>{/for}</ul>"),
                    'no `import`',
                )

                // A compile failure is tellable from any other throw BY TYPE, which is the whole
                // reason `ParseError` is exported rather than kept internal — a build shell has to
                // know whether to print a place in the file or a stack. `position` is a character
                // offset, and `locate` is what turns one into the line and column a person reads.
                const broken =
                    '<p>ok</p>\n<ul>{#for x of xs}<li>a</li><script>const b = 1</script>{/for}</ul>'
                let caught: unknown
                try {
                    compile(broken)
                } catch (failure) {
                    caught = failure
                }
                is('a compile failure is a ParseError', caught instanceof ParseError, true)
                const at = locate(broken, (caught as ParseError).position)
                is('and its position is a place in the file', at.line, 2)
                is('one-based, so it reads like an editor', at.column > 0, true)
                is(
                    'which is what `describe` formats',
                    describe(broken, 'Broken.abide', caught).startsWith(
                        `Broken.abide:${at.line}:${at.column} `,
                    ),
                    true,
                )
                is(
                    'anything else it cannot place comes back as its own text',
                    describe(broken, 'Broken.abide', new RangeError('not ours')),
                    'RangeError: not ours',
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
            title: 'the header splits by who WRITES the name, not by what it does',
            note: '`abide` is what an author types and `abide/runtime` is what only the emitter does, so a name appearing in generated output and never in a source file is off the surface an app reads. `html` is the only name on both sides: it is the template TAG a hand-written `.ts` component also writes, so it stays on `abide` and merges with the author’s own import of it — which is why no cross-module dedupe is needed. `raw` and `keyed` read like authoring vocabulary and are not: the escape hatch is spelled `{html(...)}` and a key is spelled `key={...}`, and each of those is a SPELLING the emitter translates.',
            run({ is, log }) {
                // Every emit-only name in one file: class: → classes, style: → styles, <style> →
                // adopt, {#await} → awaited, {#try} → boundary, {#for await} → streamed,
                // {html(...)} → raw, `by` → keyed. The author's own `html` import is here to prove
                // it merges rather than doubling.
                const code = compile(
                    '<script module>\nimport { html } from "abide"\n</script>\n' +
                        '<style>.a { color: red }</style>\n' +
                        '<p class:on={f} style:width={w}>{html(s)}</p>\n' +
                        '{#await p}…{:then v}<b>{v}</b>{/await}\n' +
                        '{#try}<b>{s}</b>{:catch e}<i>{e}</i>{/try}\n' +
                        '{#for await r of feed by r.id}<li>{r}</li>{/for}\n',
                    { filename: 'Everything.abide' },
                ).code
                const lines = code.split('\n')
                const from = (module: string): string =>
                    lines.find((line) => line.endsWith(`from '${module}'`)) ?? `no import from ${module}`

                is(
                    '`html` alone comes from `abide`, and the author’s own import of it merges',
                    from('abide'),
                    "import { html, type TemplateResult } from 'abide'",
                )
                is(
                    'everything the emitter alone writes comes from `abide/runtime`',
                    from('abide/runtime'),
                    "import { adopt, awaited, boundary, classes, keyed, raw, streamed, styles } from 'abide/runtime'",
                )
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
