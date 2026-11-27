// AN ITEM THAT IS ITS OWN KEY AND LABEL: a string or a number tells itself apart and reads as itself, and
// a record carrying an `id` is told apart by it, so a headless component over such items takes `key` and
// `label` as options it may leave out; over any other item the type asks for them, since `String` of an
// object is `[object Object]` for every one. 49.8.
//
// A KEY IS KEPT AS IT IS (49.21): a number stays a number, so what a component picks is typed as its
// items' keys and compared exactly, and is text only where it becomes an element's id.

import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** What tells one item from another: a string or a number, compared as it is and written as text only into an id. */
export type ItemKey = string | number

/** The key an item answers where no `key` is given: the item itself, or its `id`. */
export type KeyOf<Item> = Item extends string
    ? string
    : Item extends number
      ? number
      : Item extends { id: ItemKey }
        ? Item['id']
        : string

/**
 * `key`, optional where the item's own key — itself, or its `id` — is of a kind with the `Key` the
 * parts pick by: one assignable to the other, so a list of text picked as a union of words needs no
 * `key`, and a list of numbers picked as text does.
 */
export type KeyOption<Item, Key extends ItemKey = ItemKey> = [Item] extends [
    ItemKey | { id: ItemKey },
]
    ? [KeyOf<Item>] extends [Key]
        ? OptionalKey<Item, Key>
        : [Key] extends [KeyOf<Item>]
          ? OptionalKey<Item, Key>
          : RequiredKey<Item, Key>
    : RequiredKey<Item, Key>

type OptionalKey<Item, Key> = {
    /** What tells one item from another. Its `id`, or the item itself where it has none, by default. */
    key?: ((item: Item) => Key) | undefined
}

type RequiredKey<Item, Key> = {
    /** What tells one item from another. */
    key: (item: Item) => Key
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
export function keyOfItem<Item, Key extends ItemKey>(
    given: ((item: Item) => Key) | undefined,
    item: Item,
): Key {
    if (given !== undefined) return given(item)
    return (
        typeof item === 'object' && item !== null
            ? (item as unknown as { id: Key }).id
            : item
    ) as Key
}

/** The keys of `items` in order, as `keyOf` tells each apart: one computed every part reads (49.16). */
export function listedKeys<Item, Key extends ItemKey>(
    items: Live<readonly Item[]>,
    keyOf: (item: Item) => Key,
): Reactive<readonly Key[]> {
    return reactive((): readonly Key[] => {
        const written: Key[] = []
        for (const item of live(items)) written.push(keyOf(item))
        return written
    })
}

/** `wanted` where `listed` holds it, else the first listed: what a key no item has stands for. */
export function listedOrFirst<Key extends ItemKey>(
    listed: readonly Key[],
    wanted: Key | undefined,
): Key | undefined {
    return wanted !== undefined && listed.includes(wanted) ? wanted : listed[0]
}
