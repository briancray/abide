import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Glob } from 'bun'
import ts from 'typescript'

/*
The example apps are real abide components, so they already run through the same shadow checker
as the README blocks — `scripts/checkAbideExamples.ts` (wired into `bun run typecheck` via
`typecheck:abide`) runs `abide check` over every example app + the scaffold template.

What NOTHING checks is the code shown INSIDE those apps: the cookbook pages embed hundreds of
teaching snippets as `code={`…`}` display strings. They are deliberately partial (bare
statements, function bodies, markup fragments — only a handful are self-contained components),
so they can't be type-checked as whole modules. Two axes of the abide surface CAN be validated
against source without that context, which is the highest-value drift the build never sees:

  - `@abide/abide/*` imports resolve (module path + named export) — a moved/renamed/deleted
    export. That is exactly where a dead `watch(cell)` form once hid unchecked.
  - no removed grammar construct (`<slot>`, `<template if>`, …) appears — a snippet left stale
    when a template construct was deleted. (The real markup + README/AGENTS fenced blocks are
    parsed by checkAbide/docCodeBlocks, which throw on removed grammar; only these display
    strings escape. Prose that *names* a removed construct is not code, so it is not scanned.)
*/

const PACKAGE_ROOT = resolve(import.meta.dir, '..')
const EXAMPLES_ROOT = resolve(PACKAGE_ROOT, '../../examples')

/* The `code={`…`}` template-literal snippets in a `.abide` source, with `${…}` nesting and
   escapes handled so a snippet's own braces/backticks don't truncate it. */
function codeSnippets(source: string): string[] {
    const snippets: string[] = []
    let index = 0
    while (true) {
        const open = source.indexOf('code={`', index)
        if (open === -1) {
            break
        }
        let cursor = open + 'code={`'.length
        let depth = 0
        let body = ''
        while (cursor < source.length) {
            const char = source[cursor]!
            if (char === '\\') {
                body += source[cursor + 1] ?? ''
                cursor += 2
                continue
            }
            if (char === '$' && source[cursor + 1] === '{') {
                depth++
                body += '${'
                cursor += 2
                continue
            }
            if (char === '}' && depth > 0) {
                depth--
                body += '}'
                cursor++
                continue
            }
            if (char === '`' && depth === 0) {
                cursor++
                break
            }
            body += char
            cursor++
        }
        snippets.push(body)
        index = cursor
    }
    return snippets
}

/* Every `code={`…`}` display snippet across the example apps, tagged with its source file. */
function exampleSnippets(): { file: string; code: string }[] {
    const out: { file: string; code: string }[] = []
    for (const relative of new Glob('**/*.abide').scanSync({ cwd: EXAMPLES_ROOT })) {
        const source = readFileSync(join(EXAMPLES_ROOT, relative), 'utf8')
        for (const code of codeSnippets(source)) {
            out.push({ file: relative, code })
        }
    }
    return out
}

/* Every `@abide/abide/*` import statement text found in the example snippets, de-duplicated —
   the abide-package imports whose module path + named bindings must still resolve. */
function snippetAbideImports(): string[] {
    const importLine = /^[ \t]*import\b[^\n]*from\s*['"]@abide\/abide\/[^'"]+['"];?/gm
    const lines = new Set<string>()
    for (const { code } of exampleSnippets()) {
        for (const match of code.matchAll(importLine)) {
            lines.add(match[0].trim())
        }
    }
    return [...lines]
}

/* The removed-grammar constructs (`<slot>`, `<template if>`, …) the parser throws on, derived
   at run time from `scripts/grammarTokens.ts` (which reads them from the parser's own "was
   removed" guards — never a hand list). `F` = fixed substring, `R` = regex. */
function forbiddenGrammarTokens(): { kind: 'F' | 'R'; token: string }[] {
    const script = resolve(PACKAGE_ROOT, 'scripts/grammarTokens.ts')
    const result = Bun.spawnSync(['bun', 'run', script])
    const manifest = result.stdout.toString()
    const forbiddenSection = manifest.slice(manifest.indexOf('### forbidden'))
    const tokens: { kind: 'F' | 'R'; token: string }[] = []
    for (const line of forbiddenSection.split('\n')) {
        const match = line.match(/^([FR])\t(.+)$/)
        if (match) {
            tokens.push({ kind: match[1] as 'F' | 'R', token: match[2]! })
        }
    }
    return tokens
}

/* Each unique abide import from a display snippet is compiled as its own module against the real
   sources — a wrong module path or a renamed export fails here even though the snippet body
   (undeclared teaching names) can't be checked as a whole. */
test('every @abide/abide import in a cookbook code snippet resolves', () => {
    const imports = snippetAbideImports()
    expect(imports.length).toBeGreaterThan(0)
    const dir = mkdtempSync(join(tmpdir(), 'abide-snippet-imports-'))
    const files = imports.map((line, index) => {
        const path = join(dir, `import${index}.ts`)
        /* A lone import is a module; `export {}` keeps it one under isolatedModules and does not
           suppress the "module has no exported member" / "cannot find module" errors. */
        writeFileSync(path, `${line}\nexport {}\n`)
        return path
    })
    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        strict: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        types: [],
        baseUrl: PACKAGE_ROOT,
        paths: { '@abide/abide/*': ['src/lib/*'] },
    }
    const program = ts.createProgram(files, options)
    const unresolved: string[] = []
    for (let index = 0; index < files.length; index++) {
        const source = program.getSourceFile(files[index]!)!
        const diagnostics = program.getSemanticDiagnostics(source)
        if (diagnostics.length > 0) {
            unresolved.push(
                `${imports[index]} — ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' ')}`,
            )
        }
    }
    expect(unresolved).toEqual([])
})

/* No display snippet uses a construct the parser has removed — the drift a snippet escapes
   because it is never parsed (unlike the real markup, which checkAbide would reject). */
test('no cookbook code snippet uses a removed grammar construct', () => {
    const forbidden = forbiddenGrammarTokens()
    expect(forbidden.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const { file, code } of exampleSnippets()) {
        for (const { kind, token } of forbidden) {
            const hit = kind === 'F' ? code.includes(token) : new RegExp(token).test(code)
            if (hit) {
                violations.push(`${file}: removed construct "${token}"`)
            }
        }
    }
    expect(violations).toEqual([])
})
