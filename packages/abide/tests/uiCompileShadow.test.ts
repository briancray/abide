import { describe, expect, test } from 'bun:test'
import { compileShadow } from '../src/lib/ui/compile/compileShadow.ts'

const SOURCE = `<script>import { state } from '@abide/abide/ui/state'
import { props } from '@abide/abide/ui/props'

import Child from './Child.abide'
let count = state(0)
let todos = state<string[]>([])
const { title } = props<{ title: string }>()
const { lang } = props<{ lang?: string }>()
const doubled = state.computed(() => count * 2)
const label = state.computed<string>(() => String(count))
let start = state.linked(() => title)
let offset = state.linked<number>(() => count)
function bump() { count += 1; start = 'reset'; offset = 0 }
</script>

<style>.x { color: red }</style>

<h1>{title}</h1>
<p>{doubled} and {count.toFixed(2)}</p>
{#if count > 0}
  <button onclick={bump}>{count}</button>
{/if}
{#for n of [1, 2, 3]}
  <span>{n + count}</span>
{/for}
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
        /* A spread-free mount checks all data props as one object literal typed to the
           child's whole prop shape — so missing/excess/wrong-type are all caught. */
        expect(code).toContain('((__c: Parameters<typeof Child>[0]): void => { void __c })({')
        expect(code).toContain('name: (title)')
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
import { state } from '@abide/abide/ui/state'
let rows = state<string[]>([])
</script>
{#for row, i of rows}
  <span>{i === rows.length - 1 ? row : ''}</span>
{/for}`)
        expect(code).toContain('const i: number = 0;')
    })

    test('hoists component-local types above __Props so prop annotations resolve them', () => {
        const { code } = compileShadow(`<script>
import { props } from '@abide/abide/ui/props'
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

    test('hoists value consts above __Props so `keyof typeof` prop annotations resolve', () => {
        const { code } = compileShadow(`<script>
import { props } from '@abide/abide/ui/props'
const sizes = { sm: 'text-xs', md: 'text-sm' } as const
const { size } = props<{ size: keyof typeof sizes }>()
</script>
<span class={sizes[size]}>badge</span>`)
        /* The value const must precede __Props; emitting it as an in-function scope line
           (below __Props) leaves `keyof typeof sizes` unable to see `sizes`. */
        const constAt = code.indexOf('const sizes = {')
        const propsAt = code.indexOf('type __Props')
        const fnAt = code.indexOf('export default async function')
        expect(constAt).toBeGreaterThan(-1)
        expect(constAt).toBeLessThan(propsAt)
        expect(propsAt).toBeLessThan(fnAt)
        expect(code).toContain('type __Props = { size: keyof typeof sizes }')
    })

    test('value-projects a nested control-flow <script> like the leading one', () => {
        /* A nested signal read in the branch's markup must type-check as its value,
           not the raw `Derived`/`State` — matching the runtime deref. */
        const { code } = compileShadow(`<script>
import { state } from '@abide/abide/ui/state'
let ready = state(false)
</script>
{#await Promise.resolve('x') then loaded}
  <script>
  const upper = loaded.toUpperCase()
  let layout = state(upper)
  let label = state.computed(() => layout + '!')
  </script>
  <p>{label === 'A!' ? layout : upper}</p>
{/await}`)
        /* Reactive decls projected to value types; the plain const stays verbatim. */
        expect(code).toContain('const upper = loaded.toUpperCase()')
        expect(code).toContain('let layout = (upper);')
        expect(code).toContain("const label = (() => layout + '!')();")
        /* No raw `computed(` call survives into the nested branch body. */
        expect(code).not.toContain("let label = computed(() => layout + '!')")
    })

    test('an imported state omits the ambient fallback and value-projects the import', () => {
        const { code } = compileShadow(
            `<script>\nimport { state } from '@abide/abide/ui/state'\nlet count = state(0)\nconst doubled = state.computed(() => count * 2)</script><p>{doubled}</p>`,
        )
        /* The author's import is emitted; the ambient `declare function state` is omitted so
           the two don't collide as a duplicate identifier. */
        expect(code).toContain("import { state } from '@abide/abide/ui/state'")
        expect(code).not.toContain('declare function state<T>')
        /* Reactive decls still value-project (syntactic, import-resolution-aware). */
        expect(code).toContain('let count')
        expect(code).toContain('const doubled')
    })

    test('an aliased imported state value-projects via import resolution', () => {
        const { code } = compileShadow(
            `<script>\nimport { state as s } from '@abide/abide/ui/state'\nlet count = s(0)</script><p>{count.toFixed(2)}</p>`,
        )
        expect(code).toContain("import { state as s } from '@abide/abide/ui/state'")
        /* `s(0)` projects to the value `(0)` (number), so `.toFixed` checks — not a State cell. */
        expect(code).toContain('let count = (0);')
    })

    test('an imported effect omits the preamble effect import (no duplicate)', () => {
        const { code } = compileShadow(
            `<script>\nimport { effect } from '@abide/abide/ui/effect'\neffect(() => {})</script><p>x</p>`,
        )
        /* Exactly one `import { effect }` — the author's; the preamble drops its own. */
        expect(code.match(/import \{ effect \} from/g)).toHaveLength(1)
    })
})

test('shadow: imported props is additive with the route shape; no ambient children', () => {
    const src = `<script>
import { props } from '@abide/abide/ui/props'
const { id, children } = props<{ children: Snippet }>()
</script>
{#if children}{children()}{/if}`
    const { code } = compileShadow(src, '{ id: string }')
    // additive: route shape intersected with the annotation
    expect(code).toContain('): ({ id: string }) & T')
    // the author's props import is stripped (our declare owns the type)
    expect(code).not.toMatch(/import\s*\{\s*props\s*\}\s*from/)
    // the ambient children declaration is gone
    expect(code).not.toContain('declare const children')
})

test('shadow: props declaration is omitted when props is NOT imported', () => {
    const src = `<script>
const { id } = props()
</script>`
    const { code } = compileShadow(src, '{ id: string }')
    expect(code).not.toContain('declare function props')
})

test('shadow: an aliased props import declares under the LOCAL name, not the canonical one', () => {
    /* Alias-safe like `state`/`effect`: an author importing `props as p` must get a
       `p` declare (matching their own `p()` call), not a `props` declare that leaves
       `p` undefined — see the `state as s` aliasing already covered above. */
    const src = `<script>
import { props as p } from '@abide/abide/ui/props'
const { id } = p<{ children: Snippet }>()
</script>
{#if id}{id}{/if}`
    const { code } = compileShadow(src, '{ id: string }')
    expect(code).toContain('declare function p<T = {}>(): ({ id: string }) & T')
    expect(code).not.toContain('declare function props')
    // the author's aliased import is stripped (our declare owns the type)
    expect(code).not.toMatch(/import\s*\{\s*props\s*as\s*p\s*\}\s*from/)
})

test('shadow: only the real abide props import is stripped, not a lookalike user module', () => {
    /* The strip used to be a loose regex matching any specifier ending in ui/props — a
       user module at that path (unrelated to '@abide/abide/ui/props') must survive verbatim. */
    const src = `<script>
import { props } from './my/ui/props'
</script>
<p>{props}</p>`
    const { code } = compileShadow(src)
    expect(code).toContain(`import { props } from './my/ui/props'`)
    expect(code).not.toContain('declare function props')
})
