import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'

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
        expect(body).toContain('$$readCell(draft)') // linked reads through the unified cell read
    })

    /* A nested branch `<script>` keeps its reactive calls literal (`state.computed(...)`)
       — it declares plain, branch-local signals and is not desugared to the doc. So it
       still needs the module-level `state` import, even when the LEADING script's own
       `state(...)` calls all desugared away. The dead-reactive-import filter must weigh
       nested-script usage, not just the leading script's lowered body, or the import is
       dropped and the branch throws `ReferenceError: state is not defined` at render. */
    test('a state import used only by a nested branch script survives the dead-import filter', () => {
        const { code } = compileModule(
            `<script>import { state } from '${PKG}/ui/state'\nlet attempt = state(0)\nfunction load(_a: number): Promise<string[]> { return Promise.resolve([]) }</script>\n{#await load(attempt)}\n<p>loading</p>\n{:then names}\n<script>let total = state.computed(() => names.length)</script>\n<p>{total}</p>\n{/await}`,
            { moduleId: 'page.abide' },
        )
        expect(code).toContain(`from '${PKG}/ui/state'`)
    })

    /* The flip side: a reactive import fully consumed by lowering (no nested use) is still
       dropped — no spurious `@abide/ui` runtime dependency. The drop's independent backstop
       must NOT false-positive here: the synthesized SSR return `{ html, state, awaits, resume }`
       names a property `state`, which is not a use of the dropped `state` binding. */
    test('a fully-consumed state import is dropped without the backstop false-positiving on the SSR state property', () => {
        const { code } = compileModule(
            `<script>import { state } from '${PKG}/ui/state'\nlet count = state(0)</script><p>{count}</p>`,
            { moduleId: 'page.abide' },
        )
        expect(code).not.toContain(`from '${PKG}/ui/state'`)
    })

    /* A nested branch `<script>` keeps `state.computed`/`state.linked` literal (it is not
       desugared to the doc), so a BARE-VALUE seed must be wrapped into a thunk the same way the
       top-level desugar does — else the runtime primitive stores the value as its compute function
       and calls it on read (`... is not a function`, a runtime crash). Regression for the
       nested-vs-top-level auto-wrap inconsistency. */
    test('a nested-script bare-value state.computed is wrapped into a seed thunk', () => {
        const { code } = compileModule(
            `<script>import { state } from '${PKG}/ui/state'\nlet n = state(0)</script>\n{#if n > 0}\n<script>let doubled = state.computed(n * 2)</script>\n<p>{doubled}</p>\n{/if}`,
            { moduleId: 'page.abide' },
        )
        expect(code).toContain('state.computed(() => $$model.read("n") * 2)') // wrapped seed
        expect(code).not.toMatch(/state\.computed\(\$\$model\.read\("n"\) \* 2\)/) // never bare
    })

    test('a nested-script bare-value state.linked is wrapped into a seed thunk', () => {
        const { code } = compileModule(
            `<script>import { state } from '${PKG}/ui/state'\nlet n = state(0)</script>\n{#if n > 0}\n<script>let mirror = state.linked(n)</script>\n<p>{mirror}</p>\n{/if}`,
            { moduleId: 'page.abide' },
        )
        expect(code).toContain('state.linked(() => $$model.read("n"))') // wrapped seed
    })

    /* The wrap is a no-op on the thunk form the author usually writes — an already-thunked seed
       passes through unchanged (no double-wrap). */
    test('a nested-script thunk-form state.computed is not double-wrapped', () => {
        const { code } = compileModule(
            `<script>import { state } from '${PKG}/ui/state'\nlet n = state(0)</script>\n{#if n > 0}\n<script>let doubled = state.computed(() => n * 2)</script>\n<p>{doubled}</p>\n{/if}`,
            { moduleId: 'page.abide' },
        )
        expect(code).toContain('state.computed(() => $$model.read("n") * 2)')
        expect(code).not.toContain('state.computed(() => () =>') // not double-wrapped
    })

    test('an imported bare effect stays a runtime call and lowers its reads', () => {
        const body = compileComponent(
            `<script>import { state } from '${PKG}/ui/state'\nimport { effect } from '${PKG}/ui/effect'\nlet count = state(0)\neffect(() => console.log(count))</script><p>{count}</p>`,
        )
        expect(body).toContain('effect(') // the reaction stays a call
        expect(body).toContain('$$model.read("count")') // its reads lower like any other
    })
})
