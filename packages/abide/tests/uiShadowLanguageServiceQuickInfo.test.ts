import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShadowLanguageService } from '../src/lib/ui/compile/createShadowLanguageService.ts'

/* A throwaway project holding one component, opened as an overlay. */
function open(source: string): {
    service: ReturnType<typeof createShadowLanguageService>
    path: string
} {
    const dir = mkdtempSync(join(tmpdir(), 'abide-hover-'))
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

describe('shadow language service quickInfo', () => {
    const SOURCE = `<script>\nimport { props } from '@abide/abide/ui/props'\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title}</h1>\n`

    test('reports the value type of a template expression', () => {
        const { service, path } = open(SOURCE)
        /* Hover the `title` reference inside `{title}`. */
        const offset = SOURCE.indexOf('{title}') + 1
        const info = service.quickInfo(path, offset)
        expect(info).toBeDefined()
        expect(info!.text).toContain('string')
        /* The covered span lands on the hovered identifier in the source. */
        expect(SOURCE.slice(info!.start, info!.start + info!.length)).toBe('title')
    })

    test('returns undefined over markup that the shadow never emits', () => {
        const { service, path } = open(SOURCE)
        /* The `<h1` tag is template markup, not a checked expression. */
        expect(service.quickInfo(path, SOURCE.indexOf('<h1>'))).toBeUndefined()
    })

    /* The binding NAME at its declaration is mapped (not just the initializer), so
       hovering a reactive var shows its projected value type. Regression: only the
       initializer span was mapped, so `count` at its declaration had no hover. */
    test('reports the value type when hovering a reactive binding at its declaration', () => {
        const source = `<script>\nimport { state } from '@abide/abide/ui/state'\nconst count = state(0)\nconst doubled = state.computed(() => count * 2)\n</script>\n<p>{count}{doubled}</p>\n`
        const { service, path } = open(source)

        const countInfo = service.quickInfo(path, source.indexOf('count = state'))
        expect(countInfo).toBeDefined()
        expect(countInfo!.text).toContain('number')
        expect(source.slice(countInfo!.start, countInfo!.start + countInfo!.length)).toBe('count')

        const doubledInfo = service.quickInfo(path, source.indexOf('doubled = state'))
        expect(doubledInfo).toBeDefined()
        expect(doubledInfo!.text).toContain('number')
    })

    /* The reactive callee at its CALL site is dropped from the shadow (the rewrite
       keeps only the binding name + initializer), so hovering `state` in `state(0)`
       previously had no quick-info. The callee identifier is now mapped to its shadow
       reference, so the imported `state` / `state.computed` callees resolve. */
    test('reports the primitive signature when hovering the callee at a call site', () => {
        const source = `<script>\nimport { state } from '@abide/abide/ui/state'\nlet count = state(0)\nconst doubled = state.computed(() => count * 2)\n</script>\n<p>{count}{doubled}</p>\n`
        const { service, path } = open(source)

        const stateInfo = service.quickInfo(
            path,
            source.indexOf('count = state') + 'count = '.length,
        )
        expect(stateInfo).toBeDefined()
        expect(source.slice(stateInfo!.start, stateInfo!.start + stateInfo!.length)).toBe('state')

        const computedInfo = service.quickInfo(path, source.indexOf('computed(() => count'))
        expect(computedInfo).toBeDefined()
        expect(source.slice(computedInfo!.start, computedInfo!.start + computedInfo!.length)).toBe(
            'computed',
        )
    })
})
