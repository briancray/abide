import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { componentSemanticTokens } from '../src/abideLsp.ts'
import { ABIDE_SEMANTIC_TOKENS_LEGEND } from '../src/lib/ui/compile/ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import { createShadowLanguageService } from '../src/lib/ui/compile/createShadowLanguageService.ts'

function open(source: string) {
    const dir = mkdtempSync(join(tmpdir(), 'abide-lsp-sem-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
            },
        }),
    )
    const path = join(dir, 'Component.abide')
    const service = createShadowLanguageService(dir)
    service.update(path, source)
    return { service, path }
}

/* Decode the flat LSP data array back into absolute (line, char, len, type). */
function decode(data: number[]) {
    const out: { line: number; character: number; length: number; type: string }[] = []
    let line = 0
    let character = 0
    for (let i = 0; i + 4 < data.length; i += 5) {
        line += data[i]
        character = data[i] === 0 ? character + data[i + 1] : data[i + 1]
        out.push({
            line,
            character,
            length: data[i + 2],
            type: ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes[data[i + 3]],
        })
    }
    return out
}

describe('componentSemanticTokens', () => {
    const SOURCE = `<script>\nconst show = scope().state(true)\n</script>\n{#if show}<p>hi</p>{/if}\n`

    test('emits a keyword token for the block and a token for the expression', () => {
        const { service, path } = open(SOURCE)
        const tokens = decode(componentSemanticTokens(service, path, SOURCE))
        const ifLine = SOURCE.split('\n').findIndex((l) => l.startsWith('{#if'))
        const keyword = tokens.find((t) => t.type === 'keyword' && t.line === ifLine)
        expect(keyword).toBeDefined()
        /* The `show` reference inside `{#if show}` gets a real (non-keyword) token. */
        expect(tokens.some((t) => t.type !== 'keyword' && t.type !== 'operator')).toBe(true)
    })

    test('returns an empty array for an empty document', () => {
        const { service, path } = open(``)
        expect(componentSemanticTokens(service, path, ``)).toEqual([])
    })

    test('colors plain markup structure (tag names) with no expressions', () => {
        const SRC = `<h1>Hello</h1>\n`
        const { service, path } = open(SRC)
        const tokens = decode(componentSemanticTokens(service, path, SRC))
        expect(tokens.filter((t) => t.type === 'tag').map((t) => t.length)).toEqual([2, 2])
    })

    test('colors a string literal inside an interpolation', () => {
        const SRC = '<div>{`hello world`}</div>\n'
        const { service, path } = open(SRC)
        const tokens = decode(componentSemanticTokens(service, path, SRC))
        expect(tokens.some((t) => t.type === 'string' && t.line === 0)).toBe(true)
    })

    test('colors every line of a multiline template-literal string', () => {
        const SRC = '<div>{`hello\nworld`}</div>\n'
        const { service, path } = open(SRC)
        const tokens = decode(componentSemanticTokens(service, path, SRC))
        const stringLines = tokens.filter((t) => t.type === 'string').map((t) => t.line)
        /* Both the line the template opens on and the line it closes on are colored. */
        expect(stringLines).toContain(0)
        expect(stringLines).toContain(1)
    })
})
