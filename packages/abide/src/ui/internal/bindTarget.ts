// WHAT A `bind:` TARGET MEANS — one taxonomy, for both substrates.
//
// `bind:x={cell}` is a two-way bind, and what the target NAME selects is the same question on the server
// (which writes an attribute into an HTML string) and on the client (which attaches listeners to a live
// node). Each side stated the set itself, connected only by a comment saying "Mirrors client `bindGroup`"
// — the same arrangement `attributeDisposition.ts` was written to end for attribute VALUES, and its
// header names this as the leftover half.
//
// They had already diverged, on `selected`. The server treated it as a boolean attribute
// (`checked || selected` → present iff truthy); the client's ladder tested only `group` and `checked`,
// so `selected` fell through to `bindValue`. `<option bind:selected={x}>` therefore rendered
// `<option selected>` server-side and, on hydrate, assigned `option.value = "true"` — clobbering the
// option's own value with the bind's boolean. Same shape as the `onClick`-spread bug: SSR painted one
// thing, hydration did another, and the parity harness could not see it because both bind fixtures are
// server-only by construction.
//
// What stays per-substrate is the ACTION, which genuinely differs: the server writes an attribute
// string, the client attaches a listener and mirrors a DOM property. Only the classification is shared.

export type BindTargetKind =
    // `bind:element` — a node ref (a writable cell) or a per-instance attachment fn. Client-only: there
    // is no live node during SSR, so nothing is rendered for it at all.
    | 'element'
    // `bind:group` — radio/checkbox membership. The bound value is the GROUP's, not this input's, so
    // both sides compare it against the input's own `value` (checkbox → array membership, radio →
    // equality) and neither ever emits a literal `group` attribute.
    | 'group'
    // A BOOLEAN DOM property mirrored as a boolean attribute: present iff truthy, never stringified.
    // The property is the target's own name, which is why `selected` cannot be folded into `checked` —
    // an `<option>` carries the state on `.selected`, an `<input>` on `.checked`.
    | 'boolean'
    // Everything else — the value bind: read into the property, write back on input/change.
    | 'value'

// The boolean-attribute targets. A NAMED SET rather than a `checked`-only test, because that test is
// how `selected` came to mean two different things: adding a target here now moves both substrates at
// once, and the client mirrors the property this names.
const BOOLEAN_BIND_TARGETS = new Set(['checked', 'selected'])

export function bindTargetKind(name: string): BindTargetKind {
    if (name === 'element') return 'element'
    if (name === 'group') return 'group'
    if (BOOLEAN_BIND_TARGETS.has(name)) return 'boolean'
    return 'value'
}
