// The slice's whole value is that a test case a page shows cannot drift from the file it
// claims to come from, so what is asserted here is the SLICE and the REFUSALS — the
// output of a wrong slice is still valid-looking code, which is why the errors matter
// more than the happy path.

import { expect, test } from 'bun:test'

import { languageOf } from '../src/lib/highlight.ts'
import { slice } from '../src/lib/slice.ts'

const SOURCE = `<script>
import { state } from '@abide/abide'

const count = state(0)
const handle = state('', { transform: (v) => v.trim() })
</script>

<label>
    Handle
    <input bind:value={handle}>
</label>
<p>Saved</p>
`

const CODE = `export function describe(): string {
    // a brace in a comment: }
    const label = \`Clicked \${count()} times\`
    return label
}

export const after = 1
`

test('an anchor slices one construct, whatever kind it is', () => {
    expect(slice(SOURCE, ['const count'], 'x')).toBe('const count = state(0)')
    // The arrow's body closes on the same line, so the slice stops there rather than
    // running to the end of the enclosing `<script>`.
    expect(slice(SOURCE, ['const handle'], 'x')).toBe(
        "const handle = state('', { transform: (v) => v.trim() })",
    )
    // A tag slice takes its children; a VOID one takes only itself.
    expect(slice(SOURCE, ['<label>'], 'x')).toBe(
        '<label>\n    Handle\n    <input bind:value={handle}>\n</label>',
    )
    expect(slice(SOURCE, ['<input'], 'x')).toBe('<input bind:value={handle}>')
    expect(slice(SOURCE, ['<script>'], 'x')).toContain('</script>')
})

// The two things a naive bracket count gets wrong: a brace inside a comment, and a
// template literal's `${…}` — which nests, so it cannot be skipped wholesale.
test('a brace in a comment or a template literal does not close the slice', () => {
    const sliced = slice(CODE, ['export function describe'], 'x')
    expect(sliced).toContain('return label')
    expect(sliced.endsWith('}')).toBe(true)
    expect(sliced).not.toContain('export const after')
})

test('an anchor that is not exactly one line is refused', () => {
    expect(() => slice(SOURCE, ['const gone'], 'page')).toThrow(
        /no line starts with/,
    )
    // Two matches means the anchor stopped identifying anything, which is the failure
    // that would otherwise pick whichever line happened to come first.
    expect(() => slice(SOURCE, ['const '], 'page')).toThrow(/matches 2 lines/)
})

// An anchor is matched against the TRIMMED line, so it is written the way the code
// reads rather than the way it is indented — and what comes back is dedented to its own
// shallowest line, since a slice from inside a block would otherwise render adrift.
test('an anchor ignores indentation, and the slice drops its margin', () => {
    expect(slice(CODE, ['const label'], 'x')).toBe(
        `const label = \`Clicked \${count()} times\``,
    )
    expect(slice(SOURCE, ['<label>'], 'x').split('\n')[1]).toBe('    Handle')
})

// Several anchors are one fence, in FILE order whatever order they were asked for, and a
// gap between them is marked. Silently closing a gap would print a file that does not
// exist — two lines shown adjacent that are forty apart.
test('several anchors join into one slice, and a gap is shown — 40.16', () => {
    // Relative indentation is the FILE's, kept — the `<input>` is nested inside a label
    // forty lines down, and re-indenting it flat would print a file that does not exist.
    // The elision marker takes the indent of the run it introduces.
    const both = slice(SOURCE, ['const count', '<input'], 'x')
    expect(both).toBe(
        'const count = state(0)\n    …\n    <input bind:value={handle}>',
    )

    // Asked for backwards, returned in file order.
    expect(slice(SOURCE, ['<input', 'const count'], 'x')).toBe(both)

    // Adjacent runs join with no marker, because nothing was left out.
    expect(slice(SOURCE, ['const count', 'const handle'], 'x')).toBe(
        "const count = state(0)\nconst handle = state('', { transform: (v) => v.trim() })",
    )

    // A bad anchor is still a bad anchor when it has company.
    expect(() => slice(SOURCE, ['const count', 'const gone'], 'page')).toThrow(
        /no line starts with/,
    )
})

// A CLASS THE DOCS' OWN PARTS WRITE AND THE BUILT STYLESHEET DOES NOT CARRY renders as unstyled text
// in the middle of a designed page, and it reports nowhere: `.ex-meter` shipped that way, the request
// counts reading as a stray paragraph under its card. Read against the BUILD, which `bun run test`
// makes first, so a utility, a CRM `@utility` and a rule of `app.css` all count, and nothing else.
// THE REVERT: drop `.rules` from `app.css`, and `rules` is named.
test('every class the docs parts write resolves in the built stylesheet', async () => {
    const out =
        process.env.DOCS_OUT ?? new URL('../.abide', import.meta.url).pathname
    let css = ''
    for (const file of new Bun.Glob('client/*.css').scanSync({ cwd: out }))
        css += await Bun.file(`${out}/${file}`).text()
    const emitted = new Set<string>()
    for (const file of new Bun.Glob('*.abide').scanSync({
        cwd: new URL('../src/lib/', import.meta.url).pathname,
    })) {
        const source = await Bun.file(
            new URL(`../src/lib/${file}`, import.meta.url),
        ).text()
        for (const match of source.matchAll(/class="([a-z0-9 -]+)"/g))
            for (const name of (match[1] ?? '').split(' '))
                if (name !== '') emitted.add(name)
    }
    expect(emitted.size).toBeGreaterThan(3)
    const unstyled: string[] = []
    // A WHOLE SELECTOR, not a substring: `.ex-meterX` contains `.ex-meter`, and the first version of
    // this check passed against exactly that rename.
    for (const name of emitted) {
        if (new RegExp(`\\.${RegExp.escape(name)}(?![\\w-])`).test(css))
            continue
        unstyled.push(name)
    }
    expect(unstyled).toEqual([])
})

// A TEMPLATE LITERAL SPANS LINES, and a `}` in its text closes nothing. Read a line at a time with
// the quote state reset, a test whose expected output held `{ … }` in a multi-line literal ended at
// that brace, and one whose literal opened a line ran to the end of the file. THE REVERT: put back the
// per-line `bracketDepthOf`, and both slices end early.
test('a slice runs past a template literal and a block comment that span lines', () => {
    const source = [
        "test('a', () => {",
        '    expect(text).toBe(`{ a } { b }`)',
        '    run()',
        '})',
        "test('b', () => {",
        '    const shown = `',
        '    } }',
        '    `',
        '    /* } }',
        '    */ run()',
        '})',
        'after()',
    ].join('\n')
    expect(slice(source, ["test('a'"], 'x').split('\n').length).toBe(4)
    expect(slice(source, ["test('b'"], 'x').split('\n').length).toBe(7)
})

// 40.17 — THE LANGUAGE IS THE FILE NAME'S EXTENSION, and a name with none is its own. THE REVERT:
// the path's last `.` onward — `Dockerfile` is then `Dockerfile`, captioned `.Dockerfile`, and a
// dot in a directory names a language for the file below it.
test('a file name with no extension is its own language', () => {
    expect(languageOf('src/home/index.abide')).toBe('abide')
    expect(languageOf('bunfig.toml')).toBe('toml')
    expect(languageOf('.env')).toBe('env')
    expect(languageOf('Dockerfile')).toBe('dockerfile')
    expect(languageOf('examples/crm-10/Makefile')).toBe('makefile')
    expect(languageOf('.github/workflows/LICENSE')).toBe('license')
})
