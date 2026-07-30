import { extractBindingNames } from './analyzeBindings.ts'
import { SHORTHAND_OBJECT_PATTERN } from './SHORTHAND_OBJECT_PATTERN.ts'

// Emit statement(s) binding `pattern` from `valueExpr` onto the scope object `target` — always as an
// OWN property of `target`, so the binding SHADOWS whatever the prototype chain carries under that
// name. Every call site's target is a freshly created child scope (`Object.create($scope)`), which is
// exactly the case where "bind a name at this level" must not become "write to the level above".
//
// That is why a bare `target["x"] = value` is not enough, and the difference is not cosmetic: a
// LIVE binding one level up (`bindLazyPattern`, a `{#for}` item or a component param) is a
// getter-ONLY accessor, and an assignment to an inherited accessor with no setter writes through and
// THROWS in strict mode — `TypeError: Attempted to assign to readonly property`. Any level that
// re-binds a name already bound above it hit that: a keyed `{#for}`'s `keyFor` temp scope, a
// `{:catch}`/`{:then}` param, and — the shape with no way around it — a recursive component whose
// keyed `{#for}` reuses its own item name, where the outer and inner loop are the same source text
// and there is no inner name to rename.
//
// This SNAPSHOTS `valueExpr`, which is what a block wants when it re-binds the pattern itself on every
// reconcile (a `{#for}` item, a `{:catch}` error). Where the source is LIVE — a component's props
// object, built by the caller as getters over its own scope — a snapshot freezes the binding; that
// case is `bindLazyPattern`.
export function bindPattern(target: string, pattern: string, valueExpr: string): string {
    const trimmed = pattern.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return own(target, trimmed, valueExpr)
    const names = extractBindingNames(trimmed)
    // The common shape — a component's `({ item })` params, a `{#for}` item destructure — reached the
    // general path below, which per binding costs a closure call, a temporary object literal and an
    // `Object.assign`. Inside a list that is per ROW. Read the source once into a temp and define the
    // fields straight across instead; same bindings, none of the machinery.
    if (SHORTHAND_OBJECT_PATTERN.test(trimmed)) {
        let out = `{ const $src = ${valueExpr};`
        for (const name of names) out += ` ${own(target, name, `$src.${name}`)}`
        return `${out} }`
    }
    let out = `{ const ${trimmed} = ${valueExpr};`
    for (const name of names) out += ` ${own(target, name, name)}`
    return `${out} }`
}

// A writable/enumerable/configurable data property — a plain binding in every respect except that it
// is DEFINED rather than assigned, so an inherited accessor cannot intercept it.
function own(target: string, name: string, valueExpr: string): string {
    return `Object.defineProperty(${target}, ${JSON.stringify(name)}, { value: ${valueExpr}, writable: true, enumerable: true, configurable: true });`
}
