import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'

const PKG = '@abide/abide'

/* The imported reactive surface: `import { state } from '@abide/abide/ui/state'` +
   bare `state(0)` / `state.computed(...)` / `state.linked(...)`, recognised by
   import-binding resolution and lowered identically to the legacy `scope().state(...)`
   form. Alias-safe (`import { state as s }`). */
describe('imported reactive surface — bare state()/state.computed/state.linked lower via import resolution', () => {
    test('a bare imported state() lowers to a serializable model slot', () => {
        const body = compileComponent(
            `<script>import { state } from '${PKG}/ui/state'\nlet count = state(0)</script><p>{count}</p>`,
        )
        expect(body).toContain('$$model.replace("count", 0)') // plain state → doc slot
        expect(body).toContain('$$model.cell("count")') // its reads lower to a doc cell
    })

    test('an aliased imported state lowers identically', () => {
        const body = compileComponent(
            `<script>import { state as s } from '${PKG}/ui/state'\nlet count = s(0)</script><p>{count}</p>`,
        )
        expect(body).toContain('$$model.replace("count", 0)')
        expect(body).toContain('$$model.cell("count")')
    })

    test('state.computed lowers to a read-only derive slot', () => {
        const body = compileComponent(
            `<script>import { state } from '${PKG}/ui/state'\nlet count = state(0)\nconst doubled = state.computed(() => count * 2)</script><p>{doubled}</p>`,
        )
        expect(body).toContain('$$scope().derive("doubled"')
        expect(body).toContain('doubled()') // read as the string-free reader
    })

    test('state.linked lowers to a runtime cell routed onto the scope', () => {
        const body = compileComponent(
            `<script>import { state } from '${PKG}/ui/state'\nlet count = state(0)\nconst draft = state.linked(() => count)</script><p>{draft}</p>`,
        )
        expect(body).toContain('const draft = $$scope().linked(() => $$model.read("count"))')
        expect(body).toContain('draft.value')
    })

    test('an imported bare effect stays a runtime call and lowers its reads', () => {
        const body = compileComponent(
            `<script>import { state } from '${PKG}/ui/state'\nimport { effect } from '${PKG}/ui/effect'\nlet count = state(0)\neffect(() => console.log(count))</script><p>{count}</p>`,
        )
        expect(body).toContain('effect(') // the reaction stays a call
        expect(body).toContain('$$model.read("count")') // its reads lower like any other
    })
})
