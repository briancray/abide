import { boundValue, writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

/**
 * Keeps a file input's files in step with a `bind:files` value, both ways.
 *
 * 32.73 — A FILE INPUT'S FILES ARE A LIST, with or without `multiple`, and no markup: the server has
 * none to write. A `FileList` cannot be built, so a list written in is handed over through a
 * `DataTransfer`, and an empty one clears the input through `value`, the one write it takes.
 */
export function bindFiles(
    element: Element,
    operand: unknown,
    scope: Scope,
): void {
    const bound = element as HTMLInputElement
    scope.watch(() => {
        const files = (boundValue(operand) ?? []) as readonly File[]
        if (holdsFiles(bound.files, files)) return
        if (files.length === 0) {
            bound.value = ''
            return
        }
        const transfer = new DataTransfer()
        for (const file of files) transfer.items.add(file)
        bound.files = transfer.files
    })
    bound.addEventListener('change', () => {
        const picked: File[] = []
        for (const file of bound.files ?? []) picked.push(file)
        writeBound(operand, picked)
    })
}

/** Whether an input already holds `files`, the same files in the same order. */
function holdsFiles(held: FileList | null, files: readonly File[]): boolean {
    const count = held?.length ?? 0
    if (count !== files.length) return false
    for (let index = 0; index < count; index++)
        if ((held as FileList)[index] !== files[index]) return false
    return true
}
