// The `.abide` compiler: a file becomes the module a careful author would have written by hand.
//
// Every case here compiles a source string with the SAME `compile` the Bun loader calls, so what is
// asserted is the emitted text — and then, where the claim is about behaviour rather than shape, the
// emitted component is rendered through both substrates. The headline case is the parity one:
// `counter.abide` and `counter.ts` are the same component written twice, and the compiler's whole claim is
// that the two are indistinguishable at the output AND at the cost.

import { html } from 'abide'
import { styleTags } from 'abide/server/internal'
import { adopt, keyed, streamed } from 'abide/runtime'
import { compile, describe, locate, originalPosition, ParseError } from 'abide/compiler'
import { renderToString } from 'abide/server/internal'
import { container, scratch, sleep, suite, until } from 'harness'
import { duration, install, keep, measureFlush, nonZero, nsPerOp, tick } from 'harness/measure'
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
import { name as tallyName, runs as tallyRuns } from './fixtures/tally.abide'
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

/** The `{#component}` arrow a file declares, which sits above the return rather than inside it. */
function component(source: string): string {
    const code = compile(source, { filename: 'Case.abide' }).code
    for (const line of code.split('\n')) if (line.includes(' = (')) return line.trim()
    return ''
}

/**
 * …and the other half of the same file: the setup statements, which run once per instance. Undented,
 * because the emit indents a `<script>` body into the component function and that is formatting.
 */
function setup(source: string): string {
    const code = compile(source, { filename: 'Case.abide' }).code
    const start = code.indexOf('): TemplateResult {')
    const body = code.slice(start + '): TemplateResult {'.length, code.indexOf('return html`'))
    const lines: string[] = []
    for (const line of body.split('\n')) if (line.trim() !== '') lines.push(line.replace(/^ {4}/, ''))
    return lines.join('\n')
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
                // "Alone" is a question about TOKENS, not about the source text. `code`'s fast path
                // in `emit.ts` tests `IDENTIFIER` against the raw string, so one identifier plus
                // anything at all — a comment is enough — used to miss it and fall through to a
                // read. In a component prop that is silent and permanent: the child is handed a
                // NUMBER, `cellProps` wraps it in a fresh `state()`, and neither side's writes ever
                // reach the other again. Correct on the first paint, dead after it.
                is(
                    'a trailing comment does not make it a read',
                    template(
                        "<script>import Child from './child.abide'\nconst n = state(0)</script><Child value={n /* the running total */}/>",
                    ),
                    '${() => component(Child, { value: n /* the running total */, children: undefined })}',
                )
                is(
                    '…and composing it still reads, comment or not',
                    template(
                        "<script>import Child from './child.abide'\nconst n = state(0)</script><Child value={n + 1}/>",
                    ),
                    '${() => component(Child, { value: n() + 1, children: undefined })}',
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
            title: 'a read in setup PEEKS, because nothing would run setup again',
            note: 'A cold read SIGNALS where re-running is the recovery — a slot thunk, a `memo` body, an effect body — and the type says so: `T`, no narrowing. Setup runs once, so a read among its statements peeks instead and is honestly `T | undefined`. The split is syntactic: statements peek, function bodies read, because nothing separates a `memo` body from an event handler.',
            run({ is }) {
                is(
                    'a statement peeks',
                    setup('<script>const n = state(0)\nconst v = n + 1</script>'),
                    'const n = state(0)\nconst v = n.peek() + 1',
                )
                is(
                    '…and the same read in a template reads',
                    template('<script>const n = state(0)</script><p>{n + 1}</p>'),
                    '<p>${() => n() + 1}</p>',
                )
                // The arm that fails SILENTLY if it goes the other way: a `memo` body emitted with
                // `peek` subscribes to nothing, so the derivation is built once and never wakes —
                // and the output is right on the first pass, which is the only pass a correctness
                // test would look at.
                is(
                    'a memo body is a function body, so it reads',
                    setup('<script>const n = state(0)\nconst d = memo(() => n * 2)</script>'),
                    'const n = state(0)\nconst d = memo(() => n() * 2)',
                )
                is(
                    '…and so is a declared one, past its return type',
                    setup('<script>const n = state(0)\nfunction f(): number { return n + 1 }</script>'),
                    'const n = state(0)\nfunction f(): number { return n() + 1 }',
                )
                // `if (…) {` and `for (…) {` are blocks, not bodies — their `(` follows a keyword
                // rather than a name, which is the whole test and why no keyword list is enumerated.
                is(
                    'a control block is still a statement',
                    setup('<script>const n = state(0)\nlet v = 0\nif (n > 0) { v = n }</script>'),
                    'const n = state(0)\nlet v = 0\nif (n.peek() > 0) { v = n.peek() }',
                )
                // A keyed handle is read by its CALL, and peeks in the same position.
                is(
                    'a keyed read peeks too',
                    setup(
                        '<script>const m = memo(async ({ id }: { id: number }) => id)\nconst v = m({ id: 1 })</script>',
                    ),
                    'const m = memo(async ({ id }: { id: number }) => id)\nconst v = m({ id: 1 }).peek()',
                )
                // A branch-local script is NOT setup: it is spliced into the branch's own closure,
                // which the graph re-runs, so its statements read.
                is(
                    'a branch-local script reads',
                    template(
                        '<script>const n = state(0)</script>{#if n}<script>const v = n + 1</script><b>{v}</b>{/if}',
                    ),
                    '${() => { const $0 = n(); if ($0) return (() => {\nconst v = n() + 1\nreturn html`<b>${v}</b>` })(); return null }}',
                )
            },
        },

        {
            title: 'a write desugars to `set`, and never subscribes',
            note: 'A write reads through `peek`: a write that subscribed to what it is about to overwrite would wake itself on every OTHER writer\'s write — the same value, one extra run, and nothing about the output moves. All four spellings of an update agree on it, including the target named on its own right-hand side. Only the target: `n = other + 1` subscribes to `other`, which is a dependency the author does mean. `++` is statement-only, since a `set` has no value to hand back.',
            run({ is }) {
                const one = (body: string): string =>
                    template(
                        `<script>const n = state(0)\nconst other = state(0)</script><button onclick={${body}}>x</button>`,
                    )
                is('assignment', one('() => n = 5'), '<button @click=${() => n.set(5)}>x</button>')
                is(
                    'compound reads through peek',
                    one('() => n += 1'),
                    '<button @click=${() => n.set(n.peek() + 1)}>x</button>',
                )
                is('increment', one('() => n++'), '<button @click=${() => n.set(n.peek() + 1)}>x</button>')
                is(
                    'the target on its own right-hand side peeks, like the other three',
                    one('() => n = n + 1'),
                    '<button @click=${() => n.set(n.peek() + 1)}>x</button>',
                )
                is(
                    'and only the target — another cell still subscribes',
                    one('() => n = other + 1'),
                    '<button @click=${() => n.set(other() + 1)}>x</button>',
                )
                // The sugar is over the explicit spelling rather than instead of it, so a write that
                // DOES mean to subscribe stays reachable — there is no untrack to reach for.
                is(
                    'the explicit read is left alone, so subscribing is still writable',
                    one('() => n = n() + 1'),
                    '<button @click=${() => n.set(n() + 1)}>x</button>',
                )
            },
        },

        {
            title: 'and what that peek buys is a wake-up the effect never asked for',
            note: 'The emitted text above is the shape; this is the cost. `tally.abide` runs a real `watch` whose body writes `runs = runs + 1`, and the contract is that ANOTHER writer of `runs` does not wake it. No assertion on a value can see the difference — the counter reads the same either way — so what is asserted is the run count, and the second half is owed too: an effect that woke for nothing would pass a gate that only checks it stayed asleep.',
            async run({ is }) {
                // Read rather than assumed: the module-level effect ran at import, and this case may
                // not be the first thing in the process to have written the cell.
                const before = tallyRuns.peek()

                tallyRuns.set(before + 100) // somebody ELSE writes the cell the effect writes
                await tick()
                is('an outside write to its own cell does not wake it', tallyRuns.peek(), before + 100)

                tallyName.set(tallyName.peek() === 'ada' ? 'alan' : 'ada')
                await tick()
                is('and the cell it READS still does', tallyRuns.peek(), before + 101)
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

                // A TYPE binds nothing, and reading it as if it did is the silent half of this rule.
                // `{#component}` collected its shadows with a regex over the parameter text, which
                // cannot see a type — so every identifier in an ANNOTATION shadowed an outer cell of
                // that name, and the body read a plain value that never wakes. Answered by the same
                // walk pass one makes, which consults the type marks.
                is(
                    'an identifier in an annotation binds nothing',
                    component(`${source}{#component Row(props: { count: number })}<b>{count + 1}</b>{/component}`),
                    'const Row = (props: { count: number }) => html`<b>${() => count() + 1}</b>`',
                )
                is(
                    '…and a real parameter of that name still shadows',
                    component(`${source}{#component Row(count: number)}<b>{count + 1}</b>{/component}`),
                    'const Row = (count: number) => html`<b>${count + 1}</b>`',
                )
            },
        },

        {
            title: '`as` is a contextual keyword, so a property of that name is not a cast',
            note: 'A type region is skipped by both desugar passes, which is right for a real cast and silent when it is not one. `as`, `satisfies` and `implements` are all contextual — `{ as: 1 }`, `row.as` and `const as = 1` are ordinary JavaScript — so matching the TEXT alone turned everything to the end of the expression into a type, and any cell read inside it was never desugared. The operand before it decides now: the same `ENDS_EXPRESSION` test the lexer uses to tell division from a regex, plus `>` for the one shape that needs it.',
            run({ is }) {
                const source = "<script>import { state } from 'abide'\nconst count = state(1)\nconst row = { as: 'b' }</script>"
                // The cell is on the FAR side of the `as`, which is the half that went missing: the
                // mark ran from the keyword to the end of the expression.
                is(
                    'a key spelled `as` leaves the read after it alone',
                    template(`${source}<p>{row.as + count}</p>`),
                    '<p>${() => row.as + count()}</p>',
                )
                is(
                    '…and so does a member access spelled `.as`',
                    template(`${source}<p>{row.as}{count + 1}</p>`),
                    '<p>${row.as}${() => count() + 1}</p>',
                )
                // The other side of the rule: a real cast is still a type, so the read it wraps is
                // still erased from the setup body rather than desugared into it.
                is(
                    'a real cast is still a cast',
                    template("<script>import { state } from 'abide'\nconst count = state(1)\nconst n = count as unknown as number</script><p>{count + 1}</p>"),
                    '<p>${() => count() + 1}</p>',
                )
                is(
                    '`satisfies` still reads as one',
                    template(
                        "<script>import { state } from 'abide'\nconst count = state(1)\nconst o = { a: 1 } satisfies Record<string, number></script><p>{count + 1}</p>",
                    ),
                    '<p>${() => count() + 1}</p>',
                )
                // `implements` follows a NAME or the close of a type parameter list, and `>` is not
                // something an expression can end with — which is why the operand set is not just
                // `ENDS_EXPRESSION`.
                is(
                    'a class heritage clause, plain and generic',
                    compile(
                        '<script module>interface I<T> { x: T }\nexport class C<T> implements I<T> { x!: T }</script><p>ok</p>',
                        { filename: 'C.abide' },
                    ).code.includes('class C<T> implements I<T>'),
                    true,
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

                // A hole that is ONE string folds back into the literal, which is how SPEC says a
                // brace is written. The test is on the TOKENS: anchoring a regex to the first and
                // last character folded anything that merely began and ended with a quote, so an
                // expression BETWEEN two literals was swallowed as text and its reads went with it.
                is(
                    'a lone string folds into the literal',
                    template('<button title="{\'hi\'}">x</button>'),
                    '<button title="hi">x</button>',
                )
                is(
                    'a literal brace, which is what the fold is for',
                    template('<button title="{\'{\'}">x</button>'),
                    '<button title="{">x</button>',
                )
                is(
                    '…but a concatenation between two literals is an expression, and still reads',
                    template(
                        "<script>const name = state('x')</script><button title=\"{'Delete ' + name + '?'}\">x</button>",
                    ),
                    "<button title=${() => `${'Delete ' + name() + '?'}`}>x</button>",
                )
            },
        },

        {
            title: '`x?.()` and `x!()` are the author’s own call, punctuation and all',
            note: 'The explicit `x()` / `x.set(v)` spelling has to keep compiling — the sugar is over it, never instead of it. The guard for that read the token IMMEDIATELY after the name, so anything between the name and its call defeated it: an optional call `?.` or a non-null assertion `!`. Both then took the read branch and emitted `x()?.()` / `x()!()`, which call the CELL and then call whatever it handed back.',
            run({ is }) {
                const source = "<script>import { state } from 'abide'\nconst f = state(() => 1)\nconst name = state('x')</script>"
                is('an optional call', template(`${source}<p>{f?.()}</p>`), '<p>${() => f?.()}</p>')
                is('a non-null call', template(`${source}<p>{f!()}</p>`), '<p>${() => f!()}</p>')
                // The reserved surface is reached through the same punctuation, so it moves with it.
                is(
                    'and the write surface behind either one',
                    template(`${source}<button onclick={() => name!.set('y')}>x</button>`),
                    "<button @click=${() => name!.set('y')}>x</button>",
                )
                is(
                    'a bare name is still read',
                    template(`${source}<p>{name + 1}</p>`),
                    '<p>${() => name() + 1}</p>',
                )
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
            note: 'One spelling, two bindings on the same element: a property slot for the value and a listener that writes back. The value slot is handed the CELL, not a thunk that reads it — `unwrap` reads a slot’s source one step further, so the two write the same thing and the thunk was a fresh closure per bound input per row. The arms that cannot do that are the ones with something to compute: an accessor pair is not a cell, a boolean needs `!!` for the attribute half, and `bind:group` compares against the input’s own value. A `<select>` needs no arm at all — `.value` plus the `change` the table names for it IS the default one — so a selection is bound there and each `<option>` carries a plain `value="…"`. The listener carries the element’s own type, because the emitted file is type-checked like any other — an untyped `event` there is an implicit `any` in the author’s build. `bind:checked` and `bind:open` also emit the boolean ATTRIBUTE, so the state survives SSR. WHERE each bind is legal is a table rather than a habit: both halves have to exist on the element it is written on, so a pairing with no event to write back from is refused instead of compiling into a listener that never fires.',
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
                // `open` is `checked` with a different event, which is the whole of what the table
                // above the arm buys: one arm for both, and `<details>` gets the boolean attribute
                // so a row that is open on the server is open in the markup it sends.
                is(
                    'open is a boolean bind on a details, written back from toggle',
                    template('<script>const on = state(false)</script><details bind:open={on}><summary>s</summary></details>'),
                    '<details .open=${() => !!on()} open=${() => !!on()} @toggle=${(event: Event) => on.set((event.currentTarget as HTMLDetailsElement).open)}><summary>s</summary></details>',
                )

                throws(
                    'bind:selected is refused, and names the spelling that works',
                    () =>
                        template(
                            '<script>const chosen = state("a")</script><option bind:selected={chosen}>A</option>',
                        ),
                    'bind:value',
                )

                // The refusal `bind:selected` used to be alone in. A bind is a read AND a write, so a
                // pairing with no event to write back from is not a bind at all — and every one of
                // these compiled before the table, into a listener for an event the element does not
                // have. `bind:open` on a `<div>` was the one found in the app: an `@input` listener,
                // cast to `HTMLElement`, which has no `.open` — three defects and no diagnostic.
                throws(
                    'a bind on an element that cannot answer it is refused',
                    () => template('<script>const on = state(false)</script><div bind:open={on}></div>'),
                    'bind:open` is for <details>',
                )
                throws(
                    'and so is a bind that does not exist',
                    () => template('<script>const v = state("")</script><input bind:nope={v}/>'),
                    'there is no `bind:nope`',
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
                const host = scratch(() => Widget({}) as never)
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
            title: 'a slot cannot `await`, and the refusal names the two spellings that can',
            note: 'A slot is a THUNK, and a thunk is not async — so there is no code to emit for an `await` inside one. It used to compile to `() => await value`, which is JavaScript no engine parses, produced silently, with the error arriving from the runtime and nothing pointing back at the line. What replaces it is the thing the sugar was standing in for: a promise in a slot renders what it resolves to, and a load an author wants to say something ABOUT — a placeholder, a failure — goes in a cell, where the probes can be asked and the chain over them is what defers the region.',
            run({ is, throws }) {
                throws('a whole-expression await', () => template('<p>{await p}</p>'), 'cannot `await`')
                throws(
                    'one buried in an expression',
                    () => template('<p>{x ? await a : b}</p>'),
                    'cannot `await`',
                )
                // A name that merely starts with the letters is not an await.
                is('`awaitable` is an identifier', template('<p>{awaitable}</p>'), '<p>${awaitable}</p>')
                // A promise in a slot needs no spelling at all: both substrates render what it
                // resolves to, which is what the short form was sugar over.
                is(
                    'a promise in a slot is just a slot',
                    template('<p>{load()}</p>'),
                    '<p>${() => load()}</p>',
                )
                // A chain that asks about a load used to be MATCHED here — `{#if <cell>.pending()}`
                // as the whole of a first test — and wrapped in `awaited(cell, { pending, … })` so
                // the walk knew to defer it. Nothing recognises a spelling now: every chain is the
                // same plain thunk, and the walk defers whichever one PROBED, which it learns from
                // the probe rather than from the source. That is asserted where it is true, in the
                // `server` suite — "a region that PROBED defers, whatever the spelling".
                const wrapped = (source: string): boolean => template(source).includes('awaited(')
                is(
                    'a chain that asks about a load is a plain thunk',
                    wrapped('<script>const p = state(0)</script><p>{#if p.pending()}x{:else}y{/if}</p>'),
                    false,
                )
                is(
                    '…and so is one that does not ask',
                    wrapped('<script>const p = state(0)</script><p>{#if p}x{:else}y{/if}</p>'),
                    false,
                )
                is(
                    'the two are the SAME shape, which is the whole change',
                    template('<script>const p = state(0)</script><p>{#if p.pending()}x{:else}y{/if}</p>'),
                    '<p>${() => p.pending() ? html`x` : html`y`}</p>',
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
            title: 'an EMPTY keyed body emits a template, because a keyed row is the one never probed',
            note: '`fragment` answers `null` for a body with nothing in it, which is right for a branch arm — nothing to paint is nothing — and wrong for a keyed row. `keyed` takes a `TemplateResult` by signature, and the reconcile reads `.template` off the row WITHOUT probing, deliberately: that is the arm walked per row, and the array-row wrapper was kept off it for exactly that reason. So `{#for w of ws by w.id}{/for}` rendered `<ul></ul>` on the server and threw `null is not an object` in the browser — the same isomorphism break an array of strings had, one arm along. Fixed at the one caller that can produce it, so no keyed row pays a probe for it. The keyless arm is asserted BESIDE it because it must stay `null`: a `ChildPart` handles that, and changing both would have been the easy fix and the wrong one.',
            async run({ is }) {
                is(
                    'an empty keyed body is an empty template',
                    template('<ul>{#for w of ws by w.id}{/for}</ul>'),
                    '<ul>${() => (ws ?? []).map((w) => keyed(w.id, html``))}</ul>',
                )
                is(
                    'and an empty KEYLESS body is still null',
                    template('<ul>{#for w of ws}{/for}</ul>'),
                    '<ul>${() => (ws ?? []).map((w) => null)}</ul>',
                )

                // The half the emit assertion cannot make: that the shape it emits survives BOTH
                // substrates. The server walked this one fine while the client threw, which is why
                // an emit-only assertion would have gone green with the bug in.
                const rows = [{ id: 'a' }, { id: 'b' }]
                const view = () => html`<ul>${() => rows.map((w) => keyed(w.id, html``))}</ul>`
                const served = await renderToString(view)
                is('the server renders the empty list', served.includes('<ul>'), true)
                const host = scratch(view)
                is('and the client builds it rather than throwing', host.querySelectorAll('ul').length, 1)
                host.remove()
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
            title: 'components: a tag is a CARRIED call, children are a prop, {#component} is a value',
            note: 'A capitalised tag emits `component(View, props)` rather than `View(props)`: the call is carried to the position that shows it, which holds the instance across a re-render and writes the props into cells. Calling it in the slot thunk instead meant that anything the parent read rebuilt the child — a keyed list gaining one row rebuilt every instance in it and discarded whatever had been typed into any of them. An INLINE `{#component}` is still called directly, because it has no `<script>` and so nothing to keep. `<slot/>` renders what was passed — through whatever name the enclosing parameter list bound it under, which for an inline `{#component X(props)}` is `props` and not the outer component’s `args`. A nested `{#component X()}` inside a component’s children becomes that component’s `X` prop, which is how a render-prop is spelled without a second concept.',
            run({ is, throws }) {
                is(
                    'invocation with props',
                    template('<Card title="hi" n={1}/>'),
                    '${() => component(Card, { title: "hi", n: 1, children: undefined })}',
                )
                is(
                    'children become a prop',
                    template('<Card>hey</Card>'),
                    '${() => component(Card, { children: html`hey` })}',
                )
                is(
                    'a spread',
                    template('<Card {...rest} n={1}/>'),
                    '${() => component(Card, { ...rest, n: 1 })}',
                )
                is(
                    'onclick on a component is an ordinary prop',
                    template('<Card onclick={go}/>'),
                    '${() => component(Card, { onclick: go, children: undefined })}',
                )
                // An inline component has no setup to protect and its parameter type is written by
                // hand, so carrying it would buy nothing and cell props it declared as values.
                is(
                    'an inline component is called where it stands',
                    compile('{#component Row(props: { n: number })}[{props.n}]{/component}<Row n={1}/>', {
                        filename: 'C.abide',
                    }).code.includes('${() => Row({ n: 1, children: undefined })}'),
                    true,
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
            title: 'what LIFTS is decided by the token after `import`, so `import.meta` stays put',
            note: 'A `<script>` body is inlined into the component setup, so a static import has to be lifted out to module scope. Which statements those are is read off the token FOLLOWING the keyword — a `(` is a dynamic import and a `.` is `import.meta`, and both are expressions that belong exactly where they were written. Reading it as an OFFSET instead — a `(` at `start + 6` — let the dot through, and the half-open statement then closed on the next string literal after any `from` in the body: an `Array.from(…(\'.row\'))` was enough to lift a line to module scope and leave its own tail behind in the setup.',
            run({ is }) {
                is(
                    '`import.meta` is left in the body',
                    setup('<script>const here = import.meta.url</script><p>{here}</p>'),
                    'const here = import.meta.url',
                )
                // The tail of the bug: a later `from` is what closed the span, so the case needs one
                // AND a string after it. Without the string this passes with the offset read still in.
                is(
                    '…even with a later `from` and a string literal after it',
                    setup(
                        '<script>const here = import.meta.url\nconst rows = Array.from(document.querySelectorAll(".row"))</script><p>{here}</p>',
                    ),
                    'const here = import.meta.url\nconst rows = Array.from(document.querySelectorAll(".row"))',
                )
                is(
                    'a dynamic import is an expression and stays too',
                    setup('<script>const load = () => import("./late.ts")</script><p>{load}</p>'),
                    'const load = () => import("./late.ts")',
                )
                // All five static forms still lift, including the side-effect one, which is matched by
                // TOKEN position rather than by the whitespace it was written with.
                is(
                    'every static form still reaches module scope',
                    compile(
                        '<script>import { state } from "abide"\nimport type { T } from "./t.ts"\nimport * as ns from "./n.ts"\nimport D from "./d.abide"\nimport "./s.ts"\nconst c = state(1)</script><p>{c}</p>',
                        { filename: 'C.abide' },
                    ).code.includes("import './s.ts'"),
                    true,
                )
            },
        },

        {
            title: 'an IMPORTED props type classifies the same as the inline spelling',
            note: 'A prop’s kind is read off its member declaration as TEXT — a member whose type starts with `(` is a callback, a `KeyedMemo` is a handle, everything else is a cell. So an imported type never needed a checker, it needed the other file’s bytes. The resolver is INJECTED, the same one `elide` takes: the plugin hands over one that reads from disk, a case hands over a map in memory, and `compile` stays text in, text out. Absent, an imported type degrades to what it always did — every member a cell — which is the fallback, not an error.',
            run({ is }) {
                const models = 'export type RowProps = { row: { id: number }; onpick: (id: number) => void }'
                const source = `<script>\nimport { props } from 'abide'\nimport type { RowProps } from './models.ts'\nconst { row, onpick } = props<RowProps>()\n</script>\n<button onclick={() => onpick(row.id)}>{row.id}</button>`
                const resolved = compile(source, {
                    filename: 'C.abide',
                    resolve: () => ({ path: '/models.ts', text: models }),
                })
                // The callback is NOT wrapped, so `onpick(row.id)` calls the handler. Wrapped, the
                // same line calls the CELL and discards what it hands back — a click that does
                // nothing, with the markup and the types both still right.
                is('a function member stays plain', resolved.code.includes('const onpick = propCell('), false)
                is('…and a value member is still a cell', resolved.code.includes('const row = propCell($row)'), true)
                // The inline spelling of the same type is the control: the two must agree, because
                // the whole defect was that they did not.
                const inline = compile(
                    `<script>\nimport { props } from 'abide'\nconst { row, onpick } = props<{ row: { id: number }; onpick: (id: number) => void }>()\n</script>\n<button onclick={() => onpick(row.id)}>{row.id}</button>`,
                    { filename: 'C.abide' },
                ).code
                const bodyOf = (code: string): string =>
                    code.slice(code.indexOf('): TemplateResult {')).replace(/\s+/g, ' ')
                is('the inline spelling emits the same component', bodyOf(resolved.code), bodyOf(inline))
                // Two spellings the resolver has to follow, and the answer when it cannot.
                is(
                    'a renamed import',
                    compile(source.replace('RowProps }', 'RowProps as P }').replace('props<RowProps>', 'props<P>'), {
                        filename: 'C.abide',
                        resolve: () => ({ path: '/models.ts', text: models }),
                    }).code.includes('const onpick = propCell('),
                    false,
                )
                is(
                    'an interface rather than an alias',
                    compile(source, {
                        filename: 'C.abide',
                        resolve: () => ({
                            path: '/models.ts',
                            text: 'export interface RowProps { row: { id: number }; onpick(id: number): void }',
                        }),
                    }).code.includes('const onpick = propCell('),
                    false,
                )
                is(
                    'a resolver that answers nothing degrades to the old classification',
                    compile(source, { filename: 'C.abide', resolve: () => null }).code.includes(
                        'const onpick = propCell(',
                    ),
                    true,
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

                const a = scratch(() => handWritten())
                const b = scratch(() => Compiled({}) as never)
                await tick()
                is(
                    'and so is the DOM',
                    normalize((b.querySelector('main') as HTMLElement).innerHTML),
                    normalize((a.querySelector('main') as HTMLElement).innerHTML),
                )
            },
            bench: {
                kind: 'work',
                arms: [
                    {
                        label: 'abide — compiled from .abide, one count write',
                        prepare: () => {
                            scratch(() => Compiled({}) as never)
                        },
                        run: () => compiledCount.set(compiledCount.peek() + 1),
                    },
                    {
                        label: 'vanilla — the hand-written counter.ts, one count write',
                        prepare: () => {
                            scratch(() => handWritten())
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

                const host = scratch(() => Library({}) as never)
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

                // The other door to the same answer, and the rule is shorter here: a prop is a CELL,
                // whatever it was declared as, because the position showing the component writes each
                // one into a cell of its own. What the declared type still decides is the two things a
                // prop cell cannot be — a KEYED handle, which is selected by args, and a FUNCTION,
                // which is called rather than read. Nothing resolves the import, so the names in that
                // set are the whole test — a type of an app's own that happens to be called
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
                    '…and one declared as a plain number is read by its NAME, like every other prop',
                    template(`${declared('    n: number', 'n')}<p>{n + 1}</p>`).includes(
                        '${() => n() + 1}',
                    ),
                    true,
                )
                // The rename, which is the reason the pattern is what names them. Read off the
                // declared type alone, the cell was still called `note` and `text` stayed a plain
                // value — so `text.length` emitted a function's arity, which type-checks and renders `0`.
                is(
                    'a renamed prop follows the LOCAL name',
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
                // A callback is attached, not read. Wrapping one would hand `@click` the cell.
                is(
                    'a function prop is left alone',
                    template(
                        `${declared('    onpick: (t: string) => void', 'onpick')}` +
                            '<button @click={onpick}>x</button>',
                    ).includes('@click=${onpick}'),
                    true,
                )
                // `props()` is the parameter, so the call is erased and the import goes with it — and
                // each prop local is bound to its cell beside the destructure that renamed it out of
                // the way. The whole module rather than the template: this is about what surrounds it.
                const erased = compile(`${declared('    n: number', 'n')}<p>{n + 1}</p>`, {
                    filename: 'Case.abide',
                }).code
                is('the call becomes the parameter', erased.includes('const { n: $n } = args'), true)
                is('…and the local is the cell', erased.includes('const n = propCell($n)'), true)
                is('…and `props` is not imported by what was emitted', erased.includes('props'), false)

                // The SETUP BODY, which every assertion above is blind to — and which is the half
                // that does not reach the desugar as an author wrote it. The two lines just asserted
                // are spliced in FRONT of it, and both BIND names the walk was told are reactive, so
                // read as ordinary bindings they shadowed the very props they had made, for the rest
                // of the body. `n + 1` in a `<script>` was a function plus a number; `for (const r of
                // rows)` iterated a function; `chat({ room })` handed back a handle nobody called.
                // Nothing in the repo caught it because nothing in the repo read a prop anywhere but
                // in a template, where neither line exists.
                const setup = (members: string, bound: string, body: string): string =>
                    compile(
                        `<script>\nimport { props } from 'abide'\ntype Props = {\n${members}\n}\n` +
                            `const { ${bound} } = props<Props>()\n${body}\n</script><p>x</p>`,
                        { filename: 'Case.abide' },
                    ).code

                is(
                    'a prop is read by NAME in a setup body, the way it is in a template',
                    setup('    n: number', 'n', 'function plus(): number { return n + 1 }').includes(
                        'return n() + 1',
                    ),
                    true,
                )
                is(
                    '…and iterating one iterates the VALUE',
                    setup(
                        '    rows: string[]',
                        'rows',
                        'function count(): number { let c = 0; for (const r of rows) c += r.length; return c }',
                    ).includes('for (const r of rows())'),
                    true,
                )
                // The run-once rule, unchanged by any of this: a read among the setup's own
                // statements peeks, because setup runs once and subscribing there would subscribe
                // nobody. Inside a function it is an ordinary read, as above.
                is(
                    '…and a read among the statements themselves still PEEKS',
                    setup('    n: number', 'n', 'const first = n + 1').includes('n.peek() + 1'),
                    true,
                )
                is(
                    'a keyed prop is still read by its CALL there',
                    setup(
                        '    chat: KeyedChannel<{ room: string }, string>',
                        'chat',
                        "function say(): number { return chat({ room: 'a' }).length }",
                    ).includes("chat({ room: 'a' })().length"),
                    true,
                )
                is(
                    '…and a function prop is still called rather than read',
                    setup(
                        '    onpick: (t: string) => void',
                        'onpick',
                        "function go(): void { onpick('x') }",
                    ).includes("onpick('x')"),
                    true,
                )
            },
        },

        {
            title: 'an import from server/rpc IS the keyed declaration, because the file has none',
            note: '`rpc` = `memo` + transport, so a stub is a keyed memo — but nothing in the FILE says so: the binding walk reads `NAME = memo(…)` out of the file’s own tokens and an rpc is never written there. The import statement is the whole of the evidence, and the directory is the same fact `elide` addresses the endpoint by. Without it a page could still call the rpc and could not defer on it — `deferrable` finds no source in the head — and `{orders({ id }).total}` was a member access on the HANDLE, which type-checks as a `Rpc` and renders nothing. `server/sockets` is deliberately excluded: a socket is keyed only in the room form and an import cannot say which.',
            async run({ is }) {
                const page = (body: string, clause = '{ orders }'): string =>
                    `<script>\nimport ${clause} from '../../server/rpc/orders.ts'\n</script>${body}`

                is(
                    'the CALL is the cell, so it is read where a name would be',
                    template(page('<p>{orders({ id: 1 }).total}</p>')).includes(
                        'orders({ id: 1 })().total',
                    ),
                    true,
                )
                is(
                    '…and the reserved surface still reaches the handle',
                    template(page('<p>{orders({ id: 1 }).peek()}</p>')).includes(
                        'orders({ id: 1 }).peek()',
                    ),
                    true,
                )
                is(
                    'a pending head reads through the CALL, which is the point of knowing',
                    compile(page('{#if orders({ id: 1 }).pending()}<p>wait</p>{:else}<p>ok</p>{/if}'), {
                        filename: 'Case.abide',
                    }).code.includes('orders({ id: 1 }).pending()'),
                    true,
                )
                is(
                    'a rename binds the LOCAL name',
                    template(
                        page('<p>{recent({ id: 1 }).total}</p>', '{ orders as recent }'),
                    ).includes('recent({ id: 1 })().total'),
                    true,
                )
                is(
                    'a TYPE import declares nothing — it carries no value',
                    template(
                        page('<p>{Orders.length}</p>', 'type { Orders }'),
                    ).includes('Orders({'),
                    false,
                )
                // The directory is the rule, not the word: a module that merely mentions rpc is an
                // ordinary import, and its names stay ordinary values.
                is(
                    'a module outside server/rpc is not a source',
                    template(
                        "<script>\nimport { orders } from '../lib/rpc-helpers.ts'\n</script><p>{orders({ id: 1 }).total}</p>",
                    ).includes('orders({ id: 1 })().total'),
                    false,
                )
            },
        },

        {
            title: 'a comment in the markup is for the file, not for the wire',
            note: "A component ships one copy of its own commentary per INSTANCE, and a file header is the biggest comment it has: the dogfood app's card and source panes were 22.7 kB of a single 88 kB page that way, against 1.9 kB for every hydration marker on it. Dropping them at emit rather than at parse keeps `check` pointing a diagnostic at what a human wrote, and dropping them ONCE is what keeps the two lanes agreeing — both substrates read this one template, so a comment absent from the client's markup is absent from the server's. Whitespace is left exactly as it was, because the space between two inline elements is content and a comment sitting in it is not.",
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
                    compile('<!-- an {#if} with an {:else} arm -->\n<script module>\nconst A = 1\n</script>\n<p>ok</p>\n', {
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

                // The same mistake one diagnostic over: `props()` in a `<script module>` was found by
                // a regex over the region's RAW TEXT, so a comment naming the rule tripped the rule.
                // It is read off the region's tokens now — the same `propsCall` the setup block uses,
                // which is what makes a comment, a string and a template literal all not-a-call.
                is(
                    'a comment naming props() is not a call',
                    compile('<script module>\n// props() must move to <script>\nconst A = 1\n</script>\n<p>ok</p>\n', {
                        filename: 'C.abide',
                    }).code.includes('const A = 1'),
                    true,
                )
                throws(
                    'a real props() in a script module is still refused',
                    () =>
                        compile('<script module>\nconst p = props<{ a: number }>()\n</script>\n<p>ok</p>\n', {
                            filename: 'C.abide',
                        }),
                    'no props there',
                )

                // And the escape hatch SPEC names, for a comment that really has to reach a browser.
                is(
                    '`{raw(…)}` still emits one',
                    template("<p>{raw('<!-- kept -->')}</p>").includes('raw('),
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
                const host = scratch(() => Narrow({}) as never)
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
                const host = scratch(() => Card({}) as never)
                scratch(() => Card({}) as never)
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
            title: '{#if x.pending()} is a plain chain, and the probe is what starts the load',
            note: 'This chain used to be wrapped in `awaited(cell, { pending, then, catch })` — one arm handed over three times — so that a document render knew to defer the region and the client’s settle landed on the same template. Neither is the wrapper’s to carry now: the walk defers whatever PROBED, and the settle rebuilt the region either way, because a compiled chain’s arms are different templates and only the same shape reached the identity cutoff. Measured identical, wrapper and none. What is left is the ordinary thunk, and the claim that matters is the one below it — the handle is LAZY, and the probe in the head is what starts the load it then reports, so the pending arm is asking about a load that exists.',
            async run({ is }) {
                const emitted = compile('<script>const p = state(0)</script><p>{#if p.pending()}a{:else}b{/if}</p>', {
                    filename: 'A.abide',
                }).code
                is('no wrapper around the chain', emitted.includes('awaited('), false)
                is('the probe is in the head, untouched', emitted.includes('p.pending() ? html`a` : html`b`'), true)

                const before = calls()
                const host = scratch(() => Loader({}) as never)
                is('the pending arm first', host.textContent?.includes('loading…'), true)
                is('…and the lazy handle was STARTED by the block', calls() - before, 1)

                await sleep(80)
                is('then the settled one', host.textContent?.includes('ada'), true)
                is('the body ran ONCE', calls() - before, 1)

                // The settled block is STILL the reactive chain, and a write that changes which ARM
                // wins is the only thing that can say so — a cell inside an arm has its own slot
                // effect and repaints either way. That is what the `html` wrapper around the arm
                // buys: hand the chain over bare and it is called once, inside the block's own
                // effect, which the `holding` cutoff then never re-enters. And the write must not
                // throw the chain back to pending or re-run the body.
                label.set('moved')
                await tick()
                is('a later write can change which arm wins', host.textContent?.trim(), 'moved')
                is('…and does not re-run the body', calls() - before, 1)

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
                const host = scratch(() => Stream({}) as never)
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
                const host = scratch(() => Stream({}) as never)
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
                const host = scratch(() => Rows({}) as never)
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
            note: '`abide` is what an author types and `abide/runtime` is what only the emitter does, so a name appearing in generated output and never in a source file is off the surface an app reads. `html` and `raw` are the two names on both sides — the template TAG and the escape HATCH, both of which a hand-written `.ts` component also writes — so they stay on `abide` and merge with the author’s own import, which is why no cross-module dedupe is needed. `keyed` reads like authoring vocabulary and is not: a key is spelled `by` on a `{#for}`, which is a SPELLING the emitter translates.',
            run({ is, log }) {
                // Every emit-only name in one file: class: → classes, style: → styles, <style> →
                // adopt, {#if x.pending()} → awaited, {#try} → boundary, {#for await} → streamed,
                // `by` → keyed. `{raw(...)}` is the author's own call now, and the `html` import is
                // here to prove an authored name merges rather than doubling.
                const code = compile(
                    '<script module>\nimport { html, state } from "abide"\nconst p = state(0)\n</script>\n' +
                        '<style>.a { color: red }</style>\n' +
                        '<p class:on={f} style:width={w}>{raw(s)}</p>\n' +
                        '{#if p.pending()}…{:else}<b>{p}</b>{/if}\n' +
                        '{#try}<b>{s}</b>{:catch e}<i>{e}</i>{/try}\n' +
                        '{#for await r of feed by r.id}<li>{r}</li>{/for}\n',
                    { filename: 'Everything.abide' },
                ).code
                const lines = code.split('\n')
                const from = (module: string): string =>
                    lines.find((line) => line.endsWith(`from '${module}'`)) ?? `no import from ${module}`

                is(
                    'the author’s own names come from `abide`, and their `html` merges rather than doubling',
                    from('abide'),
                    "import { html, raw, type TemplateResult, state } from 'abide'",
                )
                is(
                    'everything the emitter alone writes comes from `abide/runtime`',
                    from('abide/runtime'),
                    "import { adopt, boundary, classes, keyed, streamed, styles } from 'abide/runtime'",
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
