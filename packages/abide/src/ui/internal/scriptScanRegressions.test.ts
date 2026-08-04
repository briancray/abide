// Scanner regressions from the whole-codebase review — all of the SAME shape: a `<script>` statement
// that never ended, so the NEXT statement was absorbed into it. Each one was silent (no throw, no
// diagnostic) and each is invisible to `abide check`, which either shares the broken scanner or splits
// correctly over the same input while the build lane does not.

import { describe, expect, test } from 'bun:test'
import { analyzeBindings } from './analyzeBindings.ts'
import { emitModuleSource } from './emit.ts'
import { parse } from './parse.ts'

function analyze(script: string, markup: string) {
    return analyzeBindings(parse(`<script>\n${script}\n</script>\n${markup}\n`))
}

describe('a declaration ending in a TYPE does not swallow the next one', () => {
    // `void` is a prefix operator in a value and a complete type in an annotation. It sits in
    // `CONTINUATION_OPERATORS.afterPrev` for the former, so `let onReset: () => void` never ended:
    // `count` became neither a binding nor a cell, `{count}` rendered empty, and `{onReset}` was
    // rewritten to `onReset()` → "onReset is not a function".
    test('an annotation ending in `void`', () => {
        const analysis = analyze(
            `import { state } from 'abide/shared/state'\nlet onReset: () => void\nlet count = state(0)`,
            `<button onclick={onReset}>{count}</button>`,
        )
        expect([...analysis.cellBindings.cells]).toContain('count')
        expect([...analysis.declared]).toContain('count')
        expect([...analysis.declared]).toContain('onReset')
    })

    // `>` is a comparison in a value and the close of a type-argument list in an annotation.
    test('an annotation ending in `>`', () => {
        const analysis = analyze(
            `import { state } from 'abide/shared/state'\nlet labels: Array<string>\nlet count = state(0)`,
            `<p>{count}</p>`,
        )
        expect([...analysis.cellBindings.cells]).toContain('count')
        expect([...analysis.declared]).toContain('labels')
    })

    // The value reading must be untouched: these are genuine mid-expression wraps.
    test('a VALUE line ending in `>` or `void` still continues', () => {
        const analysis = analyze(
            `import { state } from 'abide/shared/state'\nlet count = state(0)\nconst bigger = count() >\n  5`,
            `<p>{bigger}</p>`,
        )
        expect([...analysis.declared]).toContain('bigger')
        expect([...analysis.declared]).not.toContain('5')
    })
})

// These two are only visible in the EMITTED CODE — the binding sets look right either way, and what
// went wrong is the rewrite performed over them.
function emit(script: string, markup: string): string {
    return emitModuleSource(`<script>\n${script}\n</script>\n${markup}\n`).client
}

describe('a multi-line declarator list declares every declarator', () => {
    // `collectVarBindings` broke on any depth-0 line break with no continuation check, so `count` was
    // neither registered as a declaration name nor shadowed — and was then rewritten as a REFERENCE at
    // its own declaration site. `emitCheck` splits the same input correctly, so `abide check` stayed
    // green and only the build failed, on generated source.
    test('`let a = 1,\\n count = state(0)` is not rewritten at its own declaration site', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet a = 1,\n    count = state(0)`,
            `<p>{count}</p>`,
        )
        expect(client).not.toContain('count.set( state(0))')
        expect(client).not.toContain('count.set(state(0))')
        expect(client).toContain('count = state(0)')
    })
})

describe('a type ALIAS does not run into the next statement', () => {
    // `rhsExtent` bounded the alias with value-expression rules, so an alias ending in `void`/`>` ran
    // on and every identifier in the FOLLOWING statement was marked type-position — which excluded it
    // from the cell rewrite, leaving `count` as the raw callable. `{label}` then rendered the
    // function's source text concatenated with `1`.
    test('`type Handler = () => void` before a derivation', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet count = state(0)\ntype Handler = () => void\nconst label = count + 1`,
            `<span>{label}</span>`,
        )
        expect(client).toContain('const label = count() + 1')
    })

    test('`type Labels = Array<string>` before a derivation', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet count = state(0)\ntype Labels = Array<string>\nconst label = count + 1`,
            `<span>{label}</span>`,
        )
        expect(client).toContain('const label = count() + 1')
    })
})

describe('a call in a property VALUE is not a shorthand method', () => {
    // `markMemberTypes` tested only "identifier-like at member depth with `(` next", so `big(` in a
    // property value matched the method shape — and `markParamTypes`' return-type probe then read the
    // enclosing ternary's `:` as a return annotation and marked the ELSE branch as a type position.
    // The cell there was left un-rewritten, so `style.width` was a function whenever the condition
    // was false.
    test('the else branch of a ternary in a property value still reads its cell', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet count = state(0)\nconst big = (n) => n * 2\nconst style = { width: count > 5 ? big(count) : count }`,
            `<span>{style.width}</span>`,
        )
        expect(client).toContain('big(count()) : count()')
    })

    test('a real shorthand method in an object literal still has its params marked', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet count = state(0)\nconst api = { run(n: number) { return n + count() } }`,
            `<span>{api.run(1)}</span>`,
        )
        // `number` is a type position — it must not be rewritten as a free identifier.
        expect(client).toContain('run(n: number)')
    })
})

describe('a regex literal is one token, not its characters', () => {
    // `tokenize` never called `reScanSlashToken`, so a regex came through as `/` + code and every
    // identifier in its BODY and FLAGS was a rewrite target for both `rewriteCellRefs` and
    // `rewriteFreeIdentifiers`. `abide check` copies the expression verbatim, so it was green over all
    // of it — and no `.abide` file in the repo contained a regex literal, which is why nothing caught it.
    test('a character class is not rewritten (a WRONG ANSWER, silently)', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet v = state('a b,c')`,
            `<p>{v.split(/[\\s,]+/).length}</p>`,
        )
        expect(client).toContain('v().split(/[\\s,]+/)')
        expect(client).not.toContain('$scope.s')
    })

    test('flags are not rewritten (a BUILD ERROR in generated code)', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet v = state('a b')`,
            `<p>{v.replace(/\\s+/g, "-")}</p>`,
        )
        expect(client).toContain('v().replace(/\\s+/g, "-")')
    })

    test('a regex in a <script> is not cell-rewritten', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet n = state(0)\nconst re = /n/g`,
            `<p>{n}</p>`,
        )
        expect(client).toContain('const re = /n/g')
        expect(client).not.toContain('/n()/g')
    })

    // The control, and the reason the heuristic is conservative: real division must keep tokenizing as
    // division, or the corruption simply moves.
    test('division between two cells is still division', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet a = state(4)\nlet b = state(2)\nconst q = a / b`,
            `<p>{q}</p>`,
        )
        expect(client).toContain('const q = a() / b()')
    })
})

describe('the TEMPLATE scanner handles regex literals too', () => {
    // The tokenizer fix above covers the script/expression REWRITE; these three failed one level
    // earlier, in `parse.ts`'s own character-level scanner, and each produced a message about
    // something the author did not write.
    const script = `import { state } from 'abide/shared/state'\nlet v = state('a')\nlet s = state("a'b")`

    test('an interpolation opening with a regex is not read as a block close', () => {
        // `{/` was tested as two characters, so this parsed as `{/…}` and failed `unclosed <p>`.
        expect(() => emit(script, `<p>{/^a/.test(v)}</p>`)).not.toThrow()
    })

    test('a quote inside a regex does not open a string', () => {
        // The `'` in the pattern was scanned as a string opener → `unterminated string literal`.
        expect(() => emit(script, `<p>{s.replace(/'/g, "-")}</p>`)).not.toThrow()
    })

    test('a bracket inside a regex does not unbalance the brace scan', () => {
        expect(() => emit(script, `<p>{s.split(/[)]/).length}</p>`)).not.toThrow()
        expect(() => emit(script, `<p>{s.replace(/[{}]/g, "")}</p>`)).not.toThrow()
    })

    // The controls: real block closes and real division must be unaffected.
    test('block closes and division still parse', () => {
        expect(() => emit(`let x = 1`, `{#if x}<p>ok</p>{/if}`)).not.toThrow()
        expect(() =>
            emit(
                `import { state } from 'abide/shared/state'\nlet a = state(4)\nlet b = state(2)`,
                `<p>{a / b}</p>`,
            ),
        ).not.toThrow()
    })
})

describe('a spread attribute tolerates inner whitespace', () => {
    // The `...` test was anchored at the character right after `{`, so `<div { ...rest }>` became an
    // attribute NAMED `...rest` and failed the build with `Unexpected "..."` — a message about
    // generated code, for a spelling every other brace form in the grammar accepts.
    test('`{ ...rest }` is a spread, like `{...rest}`', () => {
        const spaced = emit(`const rest = { a: 1 }`, `<div { ...rest }>x</div>`)
        const tight = emit(`const rest = { a: 1 }`, `<div {...rest}>x</div>`)
        expect(spaced).toContain('spread')
        expect(tight).toContain('spread')
    })

    test('`{ name }` is still the shorthand attribute, not a spread', () => {
        const client = emit(`const name = 'n'`, `<div { name }>x</div>`)
        expect(client).not.toContain('spread')
    })
})

describe('a destructuring RENAME does not rewrite its key', () => {
    // The key of `{ open: initialOpen }` is not a value reference, but `isObjectKey` demanded the brace
    // be classified as an object LITERAL — which a binding pattern is not. So a prop destructured under
    // a name a cell also uses emitted `const { open(): initialOpen } = props()`: a build error on
    // generated code, and for `props()` the common case.
    test('`const { open: initialOpen } = props()` beside `let open = state(false)`', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nimport { props } from 'abide/ui/props'\nlet open = state(false)\nconst { open: initialOpen } = props()`,
            `<p>{open}{initialOpen}</p>`,
        )
        expect(client).toContain('const { open: initialOpen } = props()')
        expect(client).not.toContain('open():')
    })

    // The control: a genuine object-literal key was already skipped and must stay skipped, and a
    // shorthand VALUE must still be rewritten.
    test('an object-literal key is skipped and a shorthand value is read', () => {
        const client = emit(
            `import { state } from 'abide/shared/state'\nlet open = state(false)\nconst o = { open }`,
            `<p>{o.open}</p>`,
        )
        expect(client).toContain('open: open()')
    })
})
