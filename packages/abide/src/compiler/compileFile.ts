import type { Read } from './classifyRead.ts'
import { emitComponent } from './emitComponent.ts'
import { parseAbide } from './parseAbide.ts'

/**
 * Compiles one `.abide` source into the source of one ESM module.
 *
 * `reads` is where the checker said a name reaches a `Reactive` — `TypeSession` produces it, and
 * an empty set is the honest answer where no project was opened: every name then reads as
 * written, which is 19.12.
 */
export function compileFile(source: string, reads?: readonly Read[]): string {
    return emitComponent(parseAbide(source), reads)
}
