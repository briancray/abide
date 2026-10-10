import { expect, test } from 'bun:test'
import { splitImports } from '#compiler/splitImports.ts'

test('imports hoist and a dynamic import stays', () => {
    const r = splitImports(
        "import { reactive } from '@abide/abide'\nimport type { X } from './x.ts'\nconst a = 1\nconst m = import('./late.ts')\n",
    )
    expect(r.imports).toBe(
        "import { reactive } from '@abide/abide'\nimport type { X } from './x.ts'\n",
    )
    // The `;` each import leaves behind is the statement separator it WAS — see the ASI gate
    // below, which is the whole reason it is there.
    expect(r.body.trim()).toBe(
        ";\n;\nconst a = 1\nconst m = import('./late.ts')",
    )
})
test('a script with no imports is returned whole', () => {
    expect(splitImports('const a = 1').body).toBe('const a = 1')
})
test('an import inside a string is not one', () => {
    const r = splitImports('const s = "import x from \'y\'"\n')
    expect(r.imports).toBe('')
})

// A TEMPLATE LITERAL IS NOT ORDINARY TOKENS, and this split had its own scanner that did not know
// it — the one in `Lowering` did. THE REVERT: give `splitImports` back a scanner with no
// `reScanTemplateToken`; the import below stays in the component BODY, where `export default
// function Component() { import { a } from 'b' }` does not parse at all.
test('an import after a template literal still hoists', () => {
    const r = splitImports("const g = `hi ${who}`\nimport { a } from 'b'\n")
    expect(r.imports).toBe("import { a } from 'b'\n")
    expect(r.body).not.toContain('import {')
})

// `import.meta` IS AN EXPRESSION, NOT A DECLARATION. THE REVERT: scan forward from the `import`
// keyword for the first string literal instead of walking only the tokens an import CLAUSE can
// hold; the scan runs on past `import.meta.url` looking for a specifier, finds the next string
// literal in the file, and hoists everything between the two — 1 real statement lifted into the
// import block and `const u = ` left behind in the body.
test('import.meta is not an import declaration', () => {
    const r = splitImports(
        "const u = import.meta.url\nconst label = 'x'\nconst n = 1\n",
    )
    expect(r.imports).toBe('')
    expect(r.body).toBe(
        "const u = import.meta.url\nconst label = 'x'\nconst n = 1\n",
    )
})

// AN IMPORT ATTRIBUTE IS PART OF THE DECLARATION. THE REVERT: end the span at the specifier; the
// import hoists without its `with` clause and ` with { type: 'json' }` is left in the body as a
// `with` statement, which is illegal in a module and takes the whole file with it.
test('an import attribute hoists with its import', () => {
    const r = splitImports(
        "import data from './d.json' with { type: 'json' }\nconst a = 1\n",
    )
    expect(r.imports).toBe(
        "import data from './d.json' with { type: 'json' }\n",
    )
    expect(r.body).not.toContain('with {')
})

// AN IMPORT IS A STATEMENT AND EXCISING IT REMOVES A SEPARATOR — the silent one, because what is
// left is still a program. THE REVERT: drop the `;` written where the import was; the body below
// becomes `const x = f()\n\n[1, 2].forEach(g)`, which automatic semicolon insertion does NOT
// break, so it runs as `f()[2].forEach(g)` — a different program, with nothing about it saying so.
test('excising an import leaves the statement separator behind', async () => {
    const r = splitImports(
        "const x = f()\nimport { g } from './g.ts'\n[1, 2].forEach(g)\n",
    )
    const calls: unknown[] = []
    const f = (): number[] => [9, 9, 9]
    const g = (value: unknown): void => {
        calls.push(value)
    }
    new Function('f', 'g', r.body)(f, g)
    expect(calls).toEqual([1, 2])
})

// AN `export … from` IS A MODULE-SPECIFIER STATEMENT TOO, and it is not an `ImportKeyword`. THE
// REVERT: match only `ImportKeyword` in `importSpans`; the re-export stays in the body and the
// emitted module carries `export { a } from 'b'` INSIDE the component function, which is a syntax
// error before anything runs.
test('a re-export hoists with the imports', () => {
    const r = splitImports("export { a } from './b.ts'\nconst c = 1\n")
    expect(r.imports).toBe("export { a } from './b.ts'\n")
    expect(r.body).not.toContain('export {')
    // A bare `export` has no specifier and nothing to hoist it to — it is left where it is.
    expect(splitImports('export const a = 1\n').imports).toBe('')
})

// `assert` IS THE EARLIER SPELLING OF THE IMPORT-ATTRIBUTES CLAUSE AND IS NOT A KEYWORD — it
// scans as an ordinary identifier, so only `[no LineTerminator here]` tells the clause from a
// statement that merely begins with the name. THE REVERT: drop the brace and line-break checks
// in `importSpans`' `endOfAttributes`; the span runs to the first balanced `}` after the
// specifier, so the two statements below are hoisted into module scope — 2 statements lifted out
// of the component body where 0 are due, and a `<script>`'s own setup runs before it is mounted.
test('a statement-leading assert is not an import attribute', () => {
    const r = splitImports(
        "import { deepEqual } from 'node:assert'\nassert\n{ deepEqual(1, 1) }\n",
    )
    expect(r.imports).toBe("import { deepEqual } from 'node:assert'\n")
    expect(r.body).toContain('assert')
    expect(r.body).toContain('deepEqual(1, 1)')
    // The clause under its earlier spelling, written where it belongs, still hoists whole.
    expect(
        splitImports(
            "import data from './d.json' assert { type: 'json' }\nconst a = 1\n",
        ).imports,
    ).toBe("import data from './d.json' assert { type: 'json' }\n")
})
