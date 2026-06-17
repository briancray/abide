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
    const SOURCE = `<script>\nlet title = prop<string>('title')\n</script>\n<h1>{title}</h1>\n`

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
})
