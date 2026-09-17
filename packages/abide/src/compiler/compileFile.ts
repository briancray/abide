import { emitComponent } from './emitComponent.ts'
import { parseAbide } from './parseAbide.ts'

// One `.abide` source becomes one ESM module. `reactive` is the set of names the checker said are
// bound to a `Reactive` — `TypeSession` produces it, and an empty set is the honest answer where
// no project was opened: every name then reads as written, which is 19.12.
export function compileFile(
    source: string,
    reactive?: ReadonlySet<string>,
): string {
    return emitComponent(parseAbide(source), reactive)
}
