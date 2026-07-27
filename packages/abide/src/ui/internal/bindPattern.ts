import { extractBindingNames } from './analyzeBindings.ts'
import { SHORTHAND_OBJECT_PATTERN } from './SHORTHAND_OBJECT_PATTERN.ts'

// Emit statement(s) binding `pattern` from `valueExpr` onto the scope object `target`. A bare
// identifier is a direct `target["x"] = value` assignment; a destructuring pattern runs an IIFE that
// binds the pattern then `Object.assign`s the extracted names back onto `target`.
//
// This SNAPSHOTS `valueExpr`, which is what a block wants when it re-binds the pattern itself on every
// reconcile (a `{#for}` item, a `{:catch}` error). Where the source is LIVE — a component's props
// object, built by the caller as getters over its own scope — a snapshot freezes the binding; that
// case is `bindLazyPattern`.
export function bindPattern(target: string, pattern: string, valueExpr: string): string {
    const trimmed = pattern.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed))
        return `${target}[${JSON.stringify(trimmed)}] = ${valueExpr};`
    const names = extractBindingNames(trimmed)
    // The common shape — a component's `({ item })` params, a `{#for}` item destructure — reached the
    // general path below, which per binding costs a closure call, a temporary object literal and an
    // `Object.assign`. Inside a list that is per ROW. Read the source once into a temp and assign the
    // fields straight across instead; same bindings, none of the machinery.
    if (SHORTHAND_OBJECT_PATTERN.test(trimmed)) {
        let out = `{ const $src = ${valueExpr};`
        for (const name of names) out += ` ${target}[${JSON.stringify(name)}] = $src.${name};`
        return `${out} }`
    }
    return `Object.assign(${target}, (() => { const ${trimmed} = ${valueExpr}; return { ${names.join(', ')} }; })());`
}
