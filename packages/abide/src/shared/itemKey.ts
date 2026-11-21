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

/** The function given, or the item written as itself. */
export function itself<Item>(
    given: ((item: Item) => string) | undefined,
): (item: Item) => string {
    return given ?? ((item) => String(item))
}
