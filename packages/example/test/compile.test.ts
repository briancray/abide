// Does the compiler emit a module a JavaScript engine can PARSE?
//
// The repo's other compiler assertions live in `demos/compiler.ts`, where every case pins an exact
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
// `demos/compiler.ts`, which is where a claim about MEANING belongs; the entries below for those
// shapes are guarding the parse half only.

import { expect, test } from 'bun:test'
import { compile } from 'abide/compiler'

/** Parses as the TypeScript the emit claims to be, or throws with the engine's own message. */
function parses(code: string): void {
    new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
}

const CELLS = '<script>const n = state(0)\nconst m = state("a")\nconst on = state(true)</script>'

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
test('every .abide in the example package parses', async () => {
    const root = new URL('..', import.meta.url).pathname
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
// once, which is a property of the four `new Lexer` call sites rather than of that file.
//
// This is the failure that sharing INTRODUCES and nothing else here would see: a compile that throws
// abandons its lexer mid-scan, and if the next one inherited that state the output would be wrong
// while still parsing — so `every emitted module parses` above would stay green. A truncated source
// is the cheapest way to throw at every position in a file.
test('a compile that threw leaves nothing behind for the next one', async () => {
    const root = new URL('..', import.meta.url).pathname
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
