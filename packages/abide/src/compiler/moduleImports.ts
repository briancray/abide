import type { Lowering } from './Lowering.ts'
import { withoutProps } from './splitImports.ts'

/**
 * An emitted module's imports: each framework name `lowering` used, from its lane's runtime
 * (`SPECIFIERS.ts`), and the author's own from both script blocks, already pointed where they
 * landed (`splitImports`).
 *
 * ASKED LAST, because `used` fills as the module is emitted.
 */
export function moduleImports(
    lowering: Lowering,
    runtime: string,
    scripts: readonly { imports: string }[],
): string {
    let out =
        lowering.used.size === 0
            ? ''
            : `import { ${importClause([...lowering.used].sort())} } from '${runtime}'\n`
    for (const script of scripts) out += withoutProps(script.imports)
    return out
}

/**
 * The braces of a framework import: each name bound as `name as __name`.
 *
 * EVERY FRAMEWORK NAME IS BOUND UNDER `__`, the namespace an author does not write in: an author may
 * import a name the runtime also has into the same `<script>` —
 * `import { safeUrl } from './mine.ts'` beside one `<a href={u}>` was
 * `Identifier 'safeUrl' has already been declared` — and a `<script module>` declaring `setText` at
 * module scope collides with a runtime import made as written just the same.
 */
function importClause(names: string[]): string {
    const written: string[] = []
    for (const name of names) written.push(`${name} as __${name}`)
    return written.join(', ')
}
