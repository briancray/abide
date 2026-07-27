import { extractBindingNames } from './analyzeBindings.ts'

// A destructure of nothing but shorthand identifiers — `{ a }`, `{ a, b }`, with an optional trailing
// comma. Deliberately narrow: a default (`{ a = 1 }`), a rename (`{ a: b }`), a rest (`{ ...rest }`),
// a nested pattern or an array pattern all fail this and take the general path below, where the real
// destructuring syntax does the work rather than this regex trying to reimplement it.
const SHORTHAND_OBJECT_PATTERN = /^\{\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*,?\s*\}$/

// Emit statement(s) binding `pattern` from `valueExpr` onto the scope object `target`. A bare
// identifier is a direct `target["x"] = value` assignment; a destructuring pattern runs an IIFE that
// binds the pattern then `Object.assign`s the extracted names back onto `target`.
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
