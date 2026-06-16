import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'

/* A throwaway project with the given `.abide` files and a strict tsconfig. */
function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'abide-check-'))
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
    for (const [name, contents] of Object.entries(files)) {
        writeFileSync(join(dir, name), contents)
    }
    return dir
}

describe('abide check', () => {
    test('a well-typed template produces no diagnostics', () => {
        const dir = project({
            'clean.abide': `<script>\nlet title = prop<string>('title')\n</script>\n<h1>{title.toUpperCase()}</h1>\n`,
        })
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })

    test('a wrong member on a typed prop is caught and mapped to the expression', () => {
        const source = `<script>\nlet count = prop<number>('count')\n</script>\n<h1>{count.toUpperCase()}</h1>\n`
        const dir = project({ 'broken.abide': source })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]!.message).toContain('toUpperCase')
        /* The mapped span lands inside the offending template expression. */
        const span = source.slice(
            diagnostics[0]!.start,
            diagnostics[0]!.start + diagnostics[0]!.length,
        )
        expect('count.toUpperCase()').toContain(span)
    })

    test('a wrong prop type on a child component is caught in the parent', () => {
        const dir = project({
            'child.abide': `<script>\nlet label = prop<string>('label')\n</script>\n<span>{label}</span>\n`,
            'parent.abide': `<script>\nimport Child from './child.abide'\n</script>\n<Child label={42} />\n`,
        })
        const diagnostics = collectAbideDiagnostics(createShadowProgram(dir))
        const parent = diagnostics.filter((diagnostic) => diagnostic.file.endsWith('parent.abide'))
        expect(parent).toHaveLength(1)
        expect(parent[0]!.message).toContain('not assignable')
    })
})
