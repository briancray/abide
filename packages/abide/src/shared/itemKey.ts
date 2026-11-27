// AN ITEM THAT IS ITS OWN KEY AND LABEL: a string or a number tells itself apart and reads as itself, and
// a record carrying an `id` is told apart by it, so a headless component over such items takes `key` and
// `label` as options it may leave out; over any other item the type asks for them, since `String` of an
// object is `[object Object]` for every one. 49.8.

import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** `key`, optional where the item is a string or a number, its own key, or carries an `id`, which is. */
export type KeyOption<Item> = [Item] extends [
    string | number | { id: string | number },
]
    ? {
          /** What tells one item from another. Its `id`, or the item itself where it has none, by default. */
          key?: ((item: Item) => string) | undefined
      }
    : {
          /** What tells one item from another. */
          key: (item: Item) => string
      }

/** `label`, optional where the item is a string or a number and so reads as itself. */
export type LabelOption<Item> = [Item] extends [string | number]
    ? {
          /** What an item reads as. The item itself by default. */
          label?: ((item: Item) => string) | undefined
      }
    : {
          /** What an item reads as. */
          label: (item: Item) => string
      }

/** `item` as the function given writes it, or as itself where none is given — read each call (49.11). */
export function writtenBy<Item>(
    given: ((item: Item) => string) | undefined,
    item: Item,
): string {
    return given === undefined ? String(item) : given(item)
}

/** What tells `item` apart: what `given` answers, else its `id`, else the item itself — read each call (49.11). */
export function keyOfItem<Item>(
    given: ((item: Item) => string) | undefined,
    item: Item,
): string {
    if (given !== undefined) return given(item)
    return typeof item === 'object' && item !== null
        ? String((item as unknown as { id: unknown }).id)
        : String(item)
}

/** The keys of `items` in order, as `keyOf` tells each apart: one computed every part reads (49.16). */
export function listedKeys<Item>(
    items: Live<readonly Item[]>,
    keyOf: (item: Item) => string,
): Reactive<readonly string[]> {
    return reactive((): readonly string[] => {
        const written: string[] = []
        for (const item of live(items)) written.push(keyOf(item))
        return written
    })
}

/** `wanted` where `listed` holds it, else the first listed: what a key no item has stands for. */
export function listedOrFirst(
    listed: readonly string[],
    wanted: string | undefined,
): string | undefined {
    return wanted !== undefined && listed.includes(wanted) ? wanted : listed[0]
}
