import { describe, expect, test } from 'bun:test'
import { compileShadow } from '../src/lib/ui/compile/compileShadow.ts'

const SOURCE = `<script>
import Child from './Child.abide'
let count = state(0)
let todos = state<string[]>([])
let title = prop<string>('title')
let lang = prop<string | undefined>('lang')
const doubled = derived(() => count * 2)
const label = derived<string>(() => String(count))
function bump() { count += 1 }
</script>

<style>.x { color: red }</style>

<h1>{title}</h1>
<p>{doubled} and {count.toFixed(2)}</p>
<template if={count > 0}>
  <button onclick={bump}>{count}</button>
</template>
<template each={[1, 2, 3]} as={n}>
  <span>{n + count}</span>
</template>
<Child name={title} code={lang} />
`

describe('compileShadow', () => {
    const { code, mappings } = compileShadow(SOURCE)

    test('reconstructs the scope with value types', () => {
        expect(code).toContain('let count = (0);')
        expect(code).toContain('const doubled = (() => count * 2)();')
        expect(code).toContain('let title = props["title"];')
    })

    test('carries an explicit type argument onto the value binding', () => {
        /* Without the annotation the empty initial infers `any[]` — the squiggle bug. */
        expect(code).toContain('let todos: string[] = ([]);')
        expect(code).toContain('const label: string = (() => String(count))();')
    })

    test('maps the import statement so hover resolves on imported names', () => {
        const importLoc = SOURCE.indexOf("import Child from './Child.abide'")
        const mapping = mappings.find((entry) => entry.sourceStart === importLoc)
        expect(mapping).toBeDefined()
        expect(code.slice(mapping!.shadowStart, mapping!.shadowStart + mapping!.length)).toBe(
            "import Child from './Child.abide'",
        )
    })

    test('emits a Props interface honouring required vs optional', () => {
        expect(code).toContain('"title": string')
        expect(code).toContain('"lang"?: string | undefined')
    })

    test('checks child props against the imported component', () => {
        expect(code).toContain('Parameters<typeof Child>[0]["name"]')
        expect(code).toContain('(title)')
    })

    test('every mapping points at the exact source span it stands for', () => {
        /* The shadow text at shadowStart equals the source text at sourceStart —
           the invariant the diagnostic remapper relies on. */
        for (const { shadowStart, sourceStart, length } of mappings) {
            expect(code.slice(shadowStart, shadowStart + length)).toBe(
                SOURCE.slice(sourceStart, sourceStart + length),
            )
        }
    })

    test('maps a template interpolation back to its source offset', () => {
        const titleLoc = SOURCE.indexOf('{title}</h1>') + 1
        const mapping = mappings.find((entry) => entry.sourceStart === titleLoc)
        expect(mapping).toBeDefined()
        expect(SOURCE.slice(mapping!.sourceStart, mapping!.sourceStart + mapping!.length)).toBe(
            'title',
        )
    })

    test('CSS braces in <style> never parse as interpolations', () => {
        expect(code).not.toContain('color: red')
    })

    test('hoists component-local types above __Props so prop annotations resolve them', () => {
        const { code } = compileShadow(`<script>
type FilePropertyName = 'audio' | 'size'
let property = prop<FilePropertyName>('property')
</script>
<p>{property}</p>`)
        /* The type alias must precede the interface that references it; emitting it as
           an in-function scope line (below __Props) reintroduces the resolution bug. */
        const typeAt = code.indexOf("type FilePropertyName = 'audio' | 'size'")
        const propsAt = code.indexOf('interface __Props')
        const fnAt = code.indexOf('export default async function')
        expect(typeAt).toBeGreaterThan(-1)
        expect(typeAt).toBeLessThan(propsAt)
        expect(typeAt).toBeLessThan(fnAt)
        expect(code).toContain('"property": FilePropertyName')
    })

    test('value-projects a nested control-flow <script> like the leading one', () => {
        /* A nested signal read in the branch's markup must type-check as its value,
           not the raw `Derived`/`State` — matching the runtime deref. */
        const { code } = compileShadow(`<script>
let ready = state(false)
</script>
<template await={Promise.resolve('x')} then="loaded">
  <script>
  const upper = loaded.toUpperCase()
  let layout = state(upper)
  let label = derived(() => layout + '!')
  </script>
  <p>{label === 'A!' ? layout : upper}</p>
</template>`)
        /* Reactive decls projected to value types; the plain const stays verbatim. */
        expect(code).toContain('const upper = loaded.toUpperCase()')
        expect(code).toContain('let layout = (upper);')
        expect(code).toContain("const label = (() => layout + '!')();")
        /* No raw `derived(` call survives into the nested branch body. */
        expect(code).not.toContain("let label = derived(() => layout + '!')")
    })
})
