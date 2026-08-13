// A LOCAL that happens to share a cell's name, which the compiler was rewriting into a read.
//
// Every case here compiled to valid TypeScript and to the wrong program. That is the whole reason this
// file exists apart from `compile.test.ts`: nothing about the output looks broken, the type error lands
// on a line nobody edited, and where the local is `any`-shaped there is no error at all — just a call
// on a value that was never a cell.
//
// It cost a page before it was found. `/bench` had a memo named `showing` and `runEverything` had a
// local `const showing: BenchRow[]` one function away; the local became a read, the emitter wrote
// `showing().push(row)` over an array, and the whole page went down with it — the filter field would
// not hold a character, the kind chips stopped filtering, and `run everything` threw. One name.
//
// Three separate faults were under it, and the third only appeared once the first two were fixed:
//
//   · `boundNames` skipped any identifier before a `:` as an object-pattern key, which is also the
//     shape of every ANNOTATED binding — `const x: T = …` and `(x: T) => …` bound nothing
//   · a `function` declaration put its name and its parameters in ONE frame, opened at the enclosing
//     level, which never retires — so a parameter shadowed for the rest of the file
//   · `{` after a declarer read as a block, so a destructuring rename's `:` annotated and swallowed
//     the name it binds
//
// The last assertion is the one that catches over-fixing: an actual cell read must still be a read.

import { describe, expect, test } from 'bun:test'
import { compile } from 'abide/compiler'

/** One `<script>` body, compiled, with the template kept trivial so the assertions are about scope. */
function emitted(body: string): string {
    return compile(
        `<script>\nimport { state } from 'abide'\nconst showing = state(0)\n${body}\n</script>\n<p>{showing}</p>\n`,
        { filename: 'shadow.abide' },
    ).code
}

describe('a local named like a cell is NOT a read', () => {
    const shadows: [string, string][] = [
        ['const, annotated', 'function f(): number {\n    const showing: number[] = []\n    return showing.length\n}'],
        ['const, bare', 'function f(): number {\n    const showing = []\n    return showing.length\n}'],
        ['a parameter, annotated', 'function f(showing: number[]): number {\n    return showing.length\n}'],
        ['a parameter of an arrow', 'const f = (showing: number[]): number => showing.length'],
        ['let', 'function f(): number {\n    let showing = 0\n    showing++\n    return showing\n}'],
        ['destructured', 'function f(input: { showing: number[] }): number {\n    const { showing } = input\n    return showing.length\n}'],
        ['destructured and renamed', 'function f(input: { a: number[] }): number {\n    const { a: showing } = input\n    return showing.length\n}'],
        ['a for-of binding', 'function f(rows: number[][]): number {\n    let n = 0\n    for (const showing of rows) n += showing.length\n    return n\n}'],
        ['a catch parameter', 'function f(): string {\n    try {\n        return ""\n    } catch (showing) {\n        return String(showing)\n    }\n}'],
    ]

    for (const [what, body] of shadows) {
        test(what, () => {
            const code = emitted(body)
            // `showing()` ANYWHERE inside the function is the fault — the local is not callable, and
            // where it is `any` nothing downstream will say so either.
            const inBody = code.slice(code.indexOf('function f') === -1 ? code.indexOf('const f') : code.indexOf('function f'))
            expect(inBody).not.toContain('showing()')
        })
    }

    test('a parameter stops shadowing at the end of its function', () => {
        // The frame that never retired. A function's own frame opens at the ENCLOSING level, so
        // sharing it with the parameters left them live for the rest of the file — and the read
        // below, which is a real cell read, came out as a bare identifier.
        const code = emitted('function f(showing: number[]): number {\n    return showing.length\n}\nfunction g(): number {\n    return showing\n}')
        expect(code).toContain('function g(): number {\n        return showing()')
    })

    test('and an actual read is still a read', () => {
        expect(emitted('function g(): number {\n    return showing\n}')).toContain('return showing()')
    })
})
