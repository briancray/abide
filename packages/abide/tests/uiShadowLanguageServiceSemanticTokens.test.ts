import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShadowLanguageService } from '../src/lib/ui/compile/createShadowLanguageService.ts'

function open(source: string) {
    const dir = mkdtempSync(join(tmpdir(), 'abide-sem-'))
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

describe('shadow language service semanticClassifications', () => {
    const SOURCE = `<script>\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title}</h1>\n`

    test('classifies the template expression and maps it back onto source', () => {
        const { service, path } = open(SOURCE)
        const tokens = service.semanticClassifications(path)
        const titleToken = tokens.find((t) => SOURCE.slice(t.start, t.start + t.length) === 'title')
        expect(titleToken).toBeDefined()
        expect(['variable', 'property', 'parameter']).toContain(titleToken!.type)
    })

    test('every token lands within the source (no scaffolding leaks)', () => {
        const { service, path } = open(SOURCE)
        for (const token of service.semanticClassifications(path)) {
            expect(token.start).toBeGreaterThanOrEqual(0)
            expect(token.start + token.length).toBeLessThanOrEqual(SOURCE.length)
        }
    })

    test('returns an empty array for a component with no expressions', () => {
        const { service, path } = open(`<h1>Hello</h1>\n`)
        expect(service.semanticClassifications(path)).toEqual([])
    })
})
