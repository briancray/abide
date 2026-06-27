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

    /* Regression: block BINDING declarations (`{#for frame …}`, `{:then response}`)
       and the `by` key were emitted as unmapped scaffolding, so neither hover nor
       semantic tokens landed on them — only their body uses worked. */
    const BINDINGS = `<script>
const frames = scope().state<{ n: number; text: string }[]>([])
const promise = (async () => ({ status: 'ok' }))()
</script>
{#for frame of frames by frame.n}
  <li>{frame.text}</li>
{/for}
{#await promise}
  loading
{:then response}
  <p>{response.status}</p>
{/await}
`

    test('classifies the {#for} binding at its declaration', () => {
        const { service, path } = open(BINDINGS)
        const declaration = BINDINGS.indexOf('{#for frame') + '{#for '.length
        const tokens = service.semanticClassifications(path)
        expect(
            tokens.some(
                (t) =>
                    t.start === declaration &&
                    BINDINGS.slice(t.start, t.start + t.length) === 'frame',
            ),
        ).toBe(true)
        /* hover (same mappings) now resolves on the binding too */
        expect(service.quickInfo(path, declaration)).toBeDefined()
    })

    test('classifies the {:then} binding at its declaration', () => {
        const { service, path } = open(BINDINGS)
        const declaration = BINDINGS.indexOf('{:then response') + '{:then '.length
        const tokens = service.semanticClassifications(path)
        expect(
            tokens.some(
                (t) =>
                    t.start === declaration &&
                    BINDINGS.slice(t.start, t.start + t.length) === 'response',
            ),
        ).toBe(true)
        expect(service.quickInfo(path, declaration)).toBeDefined()
    })

    test('maps the {#for … by <key>} expression', () => {
        const { service, path } = open(BINDINGS)
        const keyAt = BINDINGS.indexOf('by frame.n') + 'by '.length
        expect(service.quickInfo(path, keyAt)).toBeDefined()
    })

    test('maps the {#for} index binding', () => {
        const source = `<script>\nconst items = scope().state<string[]>([])\n</script>\n{#for item, i of items}<li>{i}:{item}</li>{/for}\n`
        const { service, path } = open(source)
        const declaration = source.indexOf('item, i') + 'item, '.length
        const tokens = service.semanticClassifications(path)
        expect(
            tokens.some(
                (t) => t.start === declaration && source.slice(t.start, t.start + t.length) === 'i',
            ),
        ).toBe(true)
        expect(service.quickInfo(path, declaration)).toBeDefined()
    })

    test('maps the {:catch} binding', () => {
        const source = `<script>\nconst promise = Promise.resolve(1)\n</script>\n{#await promise}p{:catch err}<p>{err}</p>{/await}\n`
        const { service, path } = open(source)
        const declaration = source.indexOf('{:catch err') + '{:catch '.length
        const tokens = service.semanticClassifications(path)
        expect(
            tokens.some(
                (t) =>
                    t.start === declaration && source.slice(t.start, t.start + t.length) === 'err',
            ),
        ).toBe(true)
        expect(service.quickInfo(path, declaration)).toBeDefined()
    })

    test('maps the {#snippet name(args)} parameter binding', () => {
        const source = `{#snippet row(item)}\n  <li>{item}</li>\n{/snippet}\n`
        const { service, path } = open(source)
        const declaration = source.indexOf('row(') + 'row('.length
        const tokens = service.semanticClassifications(path)
        expect(
            tokens.some(
                (t) =>
                    t.start === declaration && source.slice(t.start, t.start + t.length) === 'item',
            ),
        ).toBe(true)
        expect(service.quickInfo(path, declaration)).toBeDefined()
    })
})
