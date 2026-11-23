// AN ITEM THAT IS ITS OWN KEY AND LABEL: a string or a number tells itself apart and reads as itself, so
// a parts function over such items takes `key` and `label` as options it may leave out; over any other
// item the type asks for them, since `String` of an object is `[object Object]` for every one.

/** `key`, optional where the item is a string or a number and so is its own key. */
export type KeyOption<Item> = [Item] extends [string | number]
    ? {
          /** What tells one item from another. The item itself by default. */
          key?: (item: Item) => string
      }
    : {
          /** What tells one item from another. */
          key: (item: Item) => string
      }

/** `label`, optional where the item is a string or a number and so reads as itself. */
export type LabelOption<Item> = [Item] extends [string | number]
    ? {
          /** What an item reads as. The item itself by default. */
          label?: (item: Item) => string
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
