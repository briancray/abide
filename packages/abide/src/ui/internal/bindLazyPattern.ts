import { extractBindingNames } from './analyzeBindings.ts'
import { SHORTHAND_OBJECT_PATTERN } from './SHORTHAND_OBJECT_PATTERN.ts'

// Emit statement(s) binding `pattern` from `sourceExpr` onto the scope object `target` LAZILY — one
// accessor per bound name, each re-reading `sourceExpr` at access time.
//
// `bindPattern`'s counterpart for a source that is LIVE. A component's props object is built by the
// CALLER as getters over its own scope, so copying the values out at mount reads each getter once and
// the binding is a snapshot from then on: `{#component Row({ item })}` inside a `{#for}` keeps the
// props it was created with, and a reordered or re-keyed row silently renders stale data. Reading
// through an accessor instead puts the caller's getter inside whatever effect the component body reads
// it from, which is what subscribes it — the same result the file-component path gets by rewriting
// each `const { title } = props()` reference to `props().title`.
//
// The cost is one `defineProperty` per declared param per component MOUNT (not per read), mirroring
// what the invocation site already spends building the props object.
export function bindLazyPattern(target: string, pattern: string, sourceExpr: string): string {
    const trimmed = pattern.trim()
    // A bare identifier takes the whole source. Still an accessor, not an assignment: `sourceExpr` is
    // re-read per access for EVERY shape here, which is the one thing a caller may rely on.
    if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return accessor(target, trimmed, sourceExpr)
    const names = extractBindingNames(trimmed)
    let out = ''
    if (SHORTHAND_OBJECT_PATTERN.test(trimmed)) {
        for (const name of names) out += accessor(target, name, `${sourceExpr}.${name}`)
        return out
    }
    // Defaults / renames / rest / nested: re-run the real destructure per read, so the syntax stays
    // the authority. A `{ a = compute() }` default therefore re-evaluates on read — which is what a
    // reactive read of a defaulted prop has to mean.
    for (const name of names)
        out += accessor(
            target,
            name,
            `(() => { const ${trimmed} = ${sourceExpr}; return ${name}; })()`,
        )
    return out
}

function accessor(target: string, name: string, readExpr: string): string {
    return `Object.defineProperty(${target}, ${JSON.stringify(name)}, { get: () => ${readExpr}, enumerable: true, configurable: true });`
}
