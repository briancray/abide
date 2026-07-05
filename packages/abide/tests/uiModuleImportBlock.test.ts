import { describe, expect, test } from 'bun:test'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { UI_RUNTIME_IMPORTS } from '../src/lib/ui/compile/UI_RUNTIME_IMPORTS.ts'

/*
The per-component dead-import filter (`compileModule`) keeps only the runtime helpers a
module references. It decides "references" by tokenizing the generated output. A template
literal with a `${…}` substitution in an event handler / binding (e.g.
`navigate(`/p?ts=${Date.now()}`)`) used to derail a raw scanner: it mis-scanned the rest
of the module as template-string content, so every helper referenced only AFTER that point
(`effect` for a later `bind:value`, `mountChild` for a later child) was dropped from the
import block — the bundle then threw `ReferenceError` the instant `build()` ran, and the
router's catch fell back to a full reload: a refresh loop. Guard: every runtime helper a
module actually calls must appear in its import block.
*/
describe('compileModule emits every runtime helper it references', () => {
    /* A `${…}` substitution in an attr handler precedes a `bind:value` (emits `effect`),
       which precedes a child mount (emits `mountChild`) — the exact ordering that lost
       the trailing imports. */
    const source = `<script>import { state } from '@abide/abide/ui/state'

import Child from './Child.abide'
const id = state('1')
</script>
<a href={\`/p?ts=\${Date.now()}\`}>link</a>
<input bind:value={id} />
<Child />`

    test('helpers used after a `${}` template literal stay imported', () => {
        const { code: output } = compileModule(source, { moduleId: 'page.abide' })
        /* The LOCAL name each specifier binds — the part after `as` for an aliased
           import (`mountChild as $$mountChild` → `$$mountChild`), else the bare name. */
        const importedNames = new Set(
            [...output.matchAll(/import\s*\{([^}]*)\}/g)].flatMap((match) =>
                match[1].split(',').map((specifier) => {
                    const [source, local] = specifier.split(/\s+as\s+/)
                    return (local ?? source).trim()
                }),
            ),
        )
        /* Codegen calls each helper by its emitted local (the `$$` alias when set). */
        const usedHelpers = UI_RUNTIME_IMPORTS.map((entry) => entry.alias ?? entry.name).filter(
            (emitted) =>
                new RegExp(`(^|[^.\\w$])${emitted.replace(/[$]/g, '\\$&')}\\s*\\(`).test(output),
        )
        const usedButUnimported = usedHelpers.filter((name) => !importedNames.has(name))
        expect(usedButUnimported).toEqual([])
    })
})
