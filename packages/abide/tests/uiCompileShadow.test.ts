import { describe, expect, test } from 'bun:test'
import { compileShadow } from '../src/lib/ui/compile/compileShadow.ts'

const SOURCE = `<script>
import Child from './Child.abide'
let count = scope().state(0)
let todos = state<string[]>([])
const { title } = props<{ title: string }>()
const { lang } = props<{ lang?: string }>()
const doubled = scope().computed(() => count * 2)
const label = computed<string>(() => String(count))
let start = scope().linked(() => title)
let offset = linked<number>(() => count)
function bump() { count += 1; start = 'reset'; offset = 0 }
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
        /* A `props()` destructure projects verbatim against the typed `props()`. */
        expect(code).toContain('const { title } = props<{ title: string }>();')
    })

    test('projects linked as a writable let, computed as a read-only const', () => {
        /* `linked` is a writable `State<T>` at runtime (it reseeds AND takes `.value =`
           writes), so reassigning it must not false-positive `abide check` with
           "Cannot assign to 'x' because it is a constant." `computed` stays `const`. */
        expect(code).toContain('let start = (() => title)();')
        expect(code).toContain('let offset: number = (() => count)();')
        expect(code).toContain('const doubled = (() => count * 2)();')
        /* The reassignment in bump() is legal against a `let` binding. */
        expect(code).not.toContain('const start =')
        expect(code).not.toContain('const offset')
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

    test('intersects each props() shape into __Props, keeping required vs optional', () => {
        expect(code).toContain('type __Props = { title: string } & { lang?: string }')
    })

    test('checks child props against the imported component', () => {
        expect(code).toContain('Parameters<typeof Child>[0]["name"]')
        expect(code).toContain('(title)')
    })

    test('checks a {...spread} against a Partial of the child props', () => {
        const { code } = compileShadow(`<script>
import Child from './Child.abide'
const extra = { name: 'x' }
</script>
<Child {...extra} />`)
        /* The spread is checked against `Partial<Props>` (subset, not completeness) and the
           spread expression lands in the checkable position. */
        expect(code).toContain('Partial<Parameters<typeof Child>[0]>')
        expect(code).toContain('(extra)')
    })

    test('a {...spread} maps its expression span past the dots', () => {
        const src = `<script>
import Child from './Child.abide'
const extra = { name: 'x' }
</script>
<Child {...extra} />`
        const { code: spreadCode, mappings: spreadMappings } = compileShadow(src)
        /* The spread's mapping must point at `extra`, not the `...` — without the dots-skip
           it would land 3 chars early and break the source-text == shadow-text invariant. */
        const exprLoc = src.indexOf('extra}')
        expect(spreadMappings.some((entry) => entry.sourceStart === exprLoc)).toBe(true)
        for (const { shadowStart, sourceStart, length } of spreadMappings) {
            expect(spreadCode.slice(shadowStart, shadowStart + length)).toBe(
                src.slice(sourceStart, sourceStart + length),
            )
        }
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

    test('declares an each index binding so body references type-check', () => {
        /* `index="i"` is a row-local number (build/SSR bind it); the shadow must declare
           it too, else `{i}` in the body false-positives "Cannot find name 'i'". */
        const { code } = compileShadow(`<script>
let rows = scope().state<string[]>([])
</script>
<template each={rows} as="row" index="i">
  <span>{i === rows.length - 1 ? row : ''}</span>
</template>`)
        expect(code).toContain('const i: number = 0;')
    })

    test('hoists component-local types above __Props so prop annotations resolve them', () => {
        const { code } = compileShadow(`<script>
type FilePropertyName = 'audio' | 'size'
const { property } = props<{ property: FilePropertyName }>()
</script>
<p>{property}</p>`)
        /* The type alias must precede the interface that references it; emitting it as
           an in-function scope line (below __Props) reintroduces the resolution bug. */
        const typeAt = code.indexOf("type FilePropertyName = 'audio' | 'size'")
        const propsAt = code.indexOf('type __Props')
        const fnAt = code.indexOf('export default async function')
        expect(typeAt).toBeGreaterThan(-1)
        expect(typeAt).toBeLessThan(propsAt)
        expect(typeAt).toBeLessThan(fnAt)
        expect(code).toContain('type __Props = { property: FilePropertyName }')
    })

    test('value-projects a nested control-flow <script> like the leading one', () => {
        /* A nested signal read in the branch's markup must type-check as its value,
           not the raw `Derived`/`State` — matching the runtime deref. */
        const { code } = compileShadow(`<script>
let ready = scope().state(false)
</script>
<template await={Promise.resolve('x')} then="loaded">
  <script>
  const upper = loaded.toUpperCase()
  let layout = scope().state(upper)
  let label = scope().computed(() => layout + '!')
  </script>
  <p>{label === 'A!' ? layout : upper}</p>
</template>`)
        /* Reactive decls projected to value types; the plain const stays verbatim. */
        expect(code).toContain('const upper = loaded.toUpperCase()')
        expect(code).toContain('let layout = (upper);')
        expect(code).toContain("const label = (() => layout + '!')();")
        /* No raw `computed(` call survives into the nested branch body. */
        expect(code).not.toContain("let label = computed(() => layout + '!')")
    })
})
