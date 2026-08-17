// Does the compiler emit a module a JavaScript engine can PARSE?
//
// The repo's other compiler assertions live in `#shared/demos/compiler.ts`, where every case pins an exact
// emitted string. That is the right shape for a claim about what the compiler produces — and it is
// blind to the failure this file is about, because it can only check inputs somebody wrote a case
// for. `bun run typecheck` has the same blind spot from the other side: it checks the emit of every
// real `.abide` in this package, and every real `.abide` in this package is code somebody wrote on
// purpose.
//
// The gap between them is where the compiler has actually broken. A `?` the desugar could not pair —
// `class C { m?() {} }`, `interface I { onClick?() }`, `declare function f(a?)` — left the next `:`
// at that nesting level looking like a ternary's, so the object literal after it emitted as
// `{ a(): 1 }`: a module that does not parse, from a file that type-checks, in a shape no case
// covered and no real file contained.
//
// So this asserts the PROPERTY rather than the output: whatever the input, the emit parses. The
// table below is one entry per shape that has broken it, plus the shapes adjacent to those. A new
// entry costs one line and is the cheapest possible record of a fix — the emitted text is free to
// change, and the property holds anyway.
//
// What it CANNOT see, stated so the next reader does not trust it further than it goes: a break that
// emits valid JavaScript meaning the wrong thing. `() => { a: cell }` is an arrow with a block body
// and a labelled statement — it parses, and renders nothing; `a ?? b === 'x' ? … : …` parses, and
// takes the wrong branch. Both have happened here. Both are pinned by exact-emit assertions in
// `#shared/demos/compiler.ts`, which is where a claim about MEANING belongs; the entries below for those
// shapes are guarding the parse half only.

import { expect, test } from 'bun:test'
import { compile } from 'abide/compiler'
import { APP_ROOT } from '#tests/PATHS.ts'

/** Parses as the TypeScript the emit claims to be, or throws with the engine's own message. */
function parses(code: string): void {
    new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
}

const CELLS = '<script>const n = state(0)\nconst m = state("a")\nconst on = state(true)</script>'

/**
 * Two statements on two lines, with no semicolon between them — which is the only thing that decides
 * which of them a `++` belongs to, and is how this codebase is written.
 *
 * A helper rather than eight spelled-out sources, because the shape under test is the PAIR: what broke
 * was reading the operator of one statement as part of the other, so every row is the same file with
 * two lines swapped in.
 */
function updating(first: string, second: string): string {
    return (
        '<script>const n = state(0)\nlet k = 0\nconst o = { k: 0 }\n' +
        `const go = (): void => {\n    ${first}\n    ${second}\n}</script><p onclick={go}>{n}</p>`
    )
}

/** One entry per shape that has broken the emit, and the shapes either side of it. */
const SOURCES: [string, string][] = [
    // An unmatched `?` — the tokens that made the desugar's ternary counter lose its place.
    [
        'a class with an optional method',
        `<script>class C { m?() {} }\nconst k = { a: 1 }</script><p>{k.a}</p>`,
    ],
    [
        'an interface with an optional method',
        `<script>interface I { go?() }\nconst k = { a: 1 }</script><p>{k.a}</p>`,
    ],
    [
        'an optional parameter',
        `<script>function f(a?: number) { return a }\nconst k = { a: 1 }</script><p>{k.a}</p>`,
    ],
    [
        'an optional member type',
        `<script>const s: { reset?() } = {}\nconst k = { a: 1 }</script><p>{k.a}</p>`,
    ],

    // `++` / `--`, which have a neighbour on BOTH sides and belong to only one of them. Without a
    // semicolon — which is how this codebase is written — the token that says which statement the
    // operator is in is the line break, so every row here is a pair of statements on two lines.
    //
    // `n++` above a cell write emitted `nc.set(c.peek() + 1) = 2`: the postfix was re-read as a prefix
    // on the name below it. The mirror shape emitted `++n()`, reading a prefix as the line above's
    // postfix and then adding a READ to the name it had just refused to increment. Both parse as
    // nothing, out of files that type-check.
    ['a plain postfix above a cell write', updating('k++', 'n = 2')],
    ['a cell postfix above a cell write', updating('n++', 'n = 2')],
    ['a cell prefix below a plain write', updating('k = 1', '++n')],
    ['a plain postfix above a cell prefix', updating('k++', '++n')],
    ['a member postfix above a cell write', updating('o.k++', 'n = 2')],
    ['a cell postfix above a plain write', updating('n++', 'k = 2')],
    ['a cell postfix above a cell prefix', updating('n++', '++n')],
    ['two cell prefixes', updating('++n', '++n')],

    // Ternaries, which share the `:` token with an object key and with an annotation.
    ['a ternary in a slot', `${CELLS}<p>{on ? n : m}</p>`],
    ['a ternary in an attribute', `${CELLS}<p title={on ? n : m}>x</p>`],
    ['an object literal in a ternary arm', `${CELLS}<p>{on ? { k: n } : { k: m }}</p>`],
    ['a ternary inside an object literal', `${CELLS}<p>{ { k: on ? n : m } }</p>`],
    ['a nested ternary', `${CELLS}<p>{on ? n : on ? m : n}</p>`],

    // An object literal reaching an arrow BODY, where `{` opens a block unless it is parenthesised.
    ['an object literal in a slot', `${CELLS}<p>{ {a: n} }</p>`],
    ['an object literal in an attribute', `${CELLS}<p title={{ a: n }}>x</p>`],
    ['an object literal in a spread', `${CELLS}<div {...{ a: n }}>s</div>`],

    // Operands pasted into a comparison or a ternary the emit writes for itself.
    ['a loose {#if} condition', `${CELLS}{#if n ?? 0}<b>y</b>{:else}<i>z</i>{/if}`],
    ['a loose {#switch} subject', `${CELLS}{#switch n ?? 0}{:case 0}a{:default}b{/switch}`],
    ['a loose {:case} value', `${CELLS}{#switch n}{:case on ? 1 : 2}a{:default}b{/switch}`],
    ['an {:else if} chain over one cell', `${CELLS}{#if n > 1}a{:else if n > 2}b{:else}c{/if}`],

    // Whitespace, which shifts an expression's recorded position without shifting its text.
    ['a doubled space in a hole', `${CELLS}<p>{ n * 100 }</p>`],
    ['a doubled space in a block header', `${CELLS}{#if  n > 10}<b>y</b>{/if}`],
    ['a doubled space in a {#for} header', '{#for  x of xs by  x.id}<li>{x}</li>{/for}'],

    // Blocks and components, which emit closures around bodies that emit closures.
    ['a block inside a row', '{#for row of rows}<li>{#if row.on}<b>y</b>{/if}</li>{/for}'],
    ['a stream with a failure arm', `${CELLS}{#for await x of n}<li>{x}</li>{:catch e}<i>{e}</i>{/for}`],
    ['a boundary around a block', '{#try}{#if risky()}<b>y</b>{/if}{:catch e}<i>bad</i>{/try}'],
    [
        'an inline component with a slot',
        '{#component Row(props: { children?: unknown })}[<slot/>]{/component}<Row><b>s</b></Row>',
    ],
    [
        'a deferring chain over the probes',
        `${CELLS}{#if p.pending()}w{:else if p.error()}<b>{p.error()}</b>{:else}<i>{p}</i>{/if}`,
    ],

    // Attribute vocabulary, each of which emits its own closure shape.
    ['a bind with an accessor pair', '<input bind:value={{ get: () => 1, set: (v: number) => v }}/>'],
    [
        'a bind group',
        `<script>const many = state<string[]>([])</script><input type="checkbox" value="x" bind:group={many}/>`,
    ],
    ['class and style toggles', `${CELLS}<b class="c" class:big={on} style:width={n}>x</b>`],
    ['an interpolated attribute', `${CELLS}<b class="row {n} end">x</b>`],
]

test('every emitted module parses', () => {
    for (const [what, source] of SOURCES) {
        let code: string
        try {
            code = compile(source, { filename: 'Case.abide' }).code
        } catch (error) {
            throw new Error(`${what}: compile threw — ${(error as Error).message}`)
        }
        try {
            parses(code)
        } catch (error) {
            throw new Error(`${what}: the emit does not parse — ${(error as Error).message}\n${code}`)
        }
    }
    expect(SOURCES.length).toBeGreaterThan(20)
})

// The same property over what the app actually ships. `bun run typecheck` already checks these, but
// it checks them as TYPES — this is the cheaper question underneath, and it is the one that answers
// first when an emit goes malformed rather than merely wrong.
test('every .abide in the dogfood package parses', async () => {
    const root = APP_ROOT
    const files = [...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true })]
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
        const source = await Bun.file(file).text()
        const code = compile(source, { filename: file }).code
        try {
            parses(code)
        } catch (error) {
            throw new Error(`${file}: the emit does not parse — ${(error as Error).message}`)
        }
    }
})

// The compiler shares ONE TypeScript scanner across every `Lexer` — see `SCANNER` in
// `compiler/internal/lex.ts` — because a `Lexer` is built per AST node and `createScanner` hands
// back several dozen closures each time. Sharing is safe only while no two `Lexer`s are alive at
// once, which is a property of the three `new Lexer` call sites rather than of that file.
//
// This is the failure that sharing INTRODUCES and nothing else here would see: a compile that throws
// abandons its lexer mid-scan, and if the next one inherited that state the output would be wrong
// while still parsing — so `every emitted module parses` above would stay green. A truncated source
// is the cheapest way to throw at every position in a file.
// A compile that never RETURNS is the one failure the property above cannot express: there is no emit to
// parse and no throw to catch, and a suite that hits it reports nothing at all — `bun test` simply stops.
//
// It was reachable from the very test below, whose whole job is to throw at every offset in the biggest
// `.abide` in the package. The shape had been latent for as long as the scanner has been shared; what
// changed was which file is biggest, so a cut finally landed on `{#` — a source ending in a lone `#`,
// where TypeScript's scanner hands back a zero-width token at that offset for ever rather than reaching
// `EndOfFile`. `{#i` always threw, because `#i` is a whole private identifier.
//
// Asserted as a DEADLINE rather than as a message, because the message is not the claim: `compile` must
// come back. Reverting the guard in `lex.ts` hangs this test rather than failing it, which is exactly why
// the bound is here.
test('a compile that cannot finish scanning still comes back', () => {
    for (const source of ['{#', '<div>{#', '{#i', '{@', '<p>{']) {
        const started = performance.now()
        expect(() => compile(source, { filename: 'stuck.abide' })).toThrow()
        expect(performance.now() - started, `${source} took too long to refuse`).toBeLessThan(1_000)
    }
})

test('a compile that threw leaves nothing behind for the next one', async () => {
    const root = APP_ROOT
    const files = [...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true })].sort()
    const sources = new Map<string, string>()
    for (const file of files) sources.set(file, await Bun.file(file).text())

    // What each file emits with nothing having thrown beforehand.
    const clean = new Map<string, string>()
    for (const [file, source] of sources) clean.set(file, compile(source, { filename: file }).code)

    const biggest = files.reduce((a, b) =>
        (sources.get(a) as string).length > (sources.get(b) as string).length ? a : b,
    )
    const whole = sources.get(biggest) as string
    const probe = files[0] as string
    let threw = 0
    // Every 37th cut, so the throw lands inside a tag, a hole, a block header and a lifted script in
    // turn rather than only at one kind of boundary.
    for (let cut = 1; cut < whole.length; cut += 37) {
        try {
            compile(whole.slice(0, cut), { filename: biggest })
        } catch {
            threw++
        }
        expect(compile(sources.get(probe) as string, { filename: probe }).code).toBe(
            clean.get(probe) as string,
        )
    }
    // A truncation that never throws would make the assertion above vacuous.
    expect(threw).toBeGreaterThan(20)
})
