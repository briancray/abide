import { describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as compileShadowModule from '../src/lib/ui/compile/compileShadow.ts'

/* Wrap `compileShadow` so the service's internal calls are counted; the service
   imports it by name, so the mock must be installed before the service module is
   imported. */
let compileCalls = 0
const realCompileShadow = compileShadowModule.compileShadow
mock.module('../src/lib/ui/compile/compileShadow.ts', () => ({
    compileShadow: (...args: Parameters<typeof realCompileShadow>) => {
        compileCalls += 1
        return realCompileShadow(...args)
    },
}))

const { createShadowLanguageService } = await import(
    '../src/lib/ui/compile/createShadowLanguageService.ts'
)

/* A throwaway project holding one opened component overlay. */
function open(source: string): {
    service: ReturnType<typeof createShadowLanguageService>
    path: string
} {
    const dir = mkdtempSync(join(tmpdir(), 'abide-memo-'))
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

const SOURCE = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title}</h1>\n`

describe('shadow language service compile memo', () => {
    test('repeated reads at one version recompile at most once and stay identical', () => {
        const { service, path } = open(SOURCE)
        const hoverAt = SOURCE.indexOf('{title}') + 1

        compileCalls = 0
        const firstInfo = service.quickInfo(path, hoverAt)
        const firstDiags = service.diagnostics(path)
        const firstTokens = service.semanticClassifications(path)
        const afterFirst = compileCalls

        /* Drive every shadow-reading entry point many more times at the same version. */
        for (let index = 0; index < 20; index += 1) {
            service.quickInfo(path, hoverAt)
            service.diagnostics(path)
            service.semanticClassifications(path)
        }

        /* No further compiles past the first cold pass. */
        expect(compileCalls).toBe(afterFirst)
        /* The cold pass compiles the component at most once PER shadow world despite three entry
           points — twice total: the verbatim classifier pass and the peek-wrapped main pass (ADR-
           0032). Both are memoised per version, so the count is bounded, not the churn. */
        expect(afterFirst).toBeLessThanOrEqual(2)

        /* Output is byte-identical across versions. */
        expect(service.quickInfo(path, hoverAt)).toEqual(firstInfo)
        expect(service.diagnostics(path)).toEqual(firstDiags)
        expect(service.semanticClassifications(path)).toEqual(firstTokens)
    })

    test('update invalidates the memo and recompiles', () => {
        const { service, path } = open(SOURCE)
        service.quickInfo(path, 0)

        compileCalls = 0
        /* Same version → no recompile. */
        service.quickInfo(path, 0)
        expect(compileCalls).toBe(0)

        /* A new overlay bumps the version → next read recompiles and reflects it. */
        const next = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: number }>()\n</script>\n<h1>{title}</h1>\n`
        service.update(path, next)
        const hoverAt = next.indexOf('{title}') + 1
        const info = service.quickInfo(path, hoverAt)
        expect(compileCalls).toBeGreaterThan(0)
        expect(info!.text).toContain('number')
    })
})
