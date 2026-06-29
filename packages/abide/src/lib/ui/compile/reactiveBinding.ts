import { destructureBindingNames } from './destructureBindingNames.ts'
import type { Binding } from './types/Binding.ts'

/* How the client back-end binds a `reactive` Binding (an `await` `then` value, a keyed
   `each` item / index): the value arrives as a `.value` cell the runtime can update in
   place, so the consuming branch/row re-runs in place on a re-settle/re-key rather than
   being rebuilt. THE RENDERER of a `reactive` classification — it takes the Binding the
   plan declared, never a raw author param, so a back-end can only render what the plan
   classified. `param` is the thunk's value parameter (the cell), `prefix` declares any
   per-leaf readers, `localNames` (the Binding's leaf names) enter the deref scope for the
   body. A plain identifier reads the cell directly (`item` → `item.value`); a destructure
   re-applies over the cell per read so each leaf stays reactive (JS handles
   defaults/rest/rename/nesting). */
export type ReactiveBindingWiring = {
    param: string
    prefix: string
    localNames: string[]
}

/* Matches a JS identifier — a plain `as`/index that reads the cell directly, vs a
   destructuring pattern that re-applies per read. */
const isPlainIdentifier = (name: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)

/* Renders a `reactive` Binding's cell wiring for the client back-end. `nextVar` mints the
   synthetic cell/derive vars; `lowerStatement` lowers the destructure declaration so a
   default/computed-key initializer referencing a component signal is rewritten to its
   `model`/cell form (the bound leaf names are name-slots, untouched). */
export function reactiveBinding(
    binding: Binding,
    nextVar: (hint: string) => string,
    lowerStatement: (code: string) => string,
): ReactiveBindingWiring {
    const authorParam = binding.name
    if (isPlainIdentifier(authorParam)) {
        return { param: authorParam, prefix: '', localNames: [authorParam] }
    }
    const cellParam = nextVar('aw')
    const deriveVar = nextVar('ad')
    const leaves = destructureBindingNames(authorParam)
    const declaration = lowerStatement(`const ${authorParam} = ${cellParam}.value`)
    const prefix =
        `const ${deriveVar} = { get value() { ${declaration} return { ${leaves.join(', ')} }; } };\n` +
        leaves
            .map(
                (leaf) =>
                    `const ${leaf} = { get value() { return ${deriveVar}.value.${leaf}; } };\n`,
            )
            .join('')
    return { param: cellParam, prefix, localNames: leaves }
}
