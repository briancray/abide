// WHAT WAS WRONG, KEYED BY WHERE. The shape a `schema` refusal carries, and therefore the
// `data` of a `ValidationError` (15.8).
//
// THE EMPTY KEY IS THE WHOLE VALUE. A refusal about the object itself — "these two fields
// contradict each other" — has no field to hang off, and inventing a name for it would put
// a string in the record that no path can ever match. `''` is the one key that cannot
// collide with a path, because a path is built from property names and none of them is
// empty.
//
// A NON-OBJECT IS A BARE LIST for the same reason: `Issues<string>` over a scalar has
// nowhere to key by, and `{ '': string[] }` for that case is a wrapper every reader would
// have to unwrap.

type Down = [0, 0, 1, 2, 3, 4]

/**
 * Every dot-joined path into `T`, widened to `string` past five levels.
 *
 * 19.5: DOT-JOINED, DEPTH-LIMITED, AND WIDENED TO `string` PAST THE LIMIT. The limit is
 * not a style choice — a recursive path type over a self-referential shape (a tree node
 * whose children are tree nodes) expands forever, and TypeScript answers that with
 * "excessively deep" on the whole file rather than on the type that caused it. Five levels
 * is past anything a form posts and short enough that the expansion stays cheap.
 *
 * WIDENING RATHER THAN STOPPING is what keeps the deep case usable: past the limit any
 * string is accepted as a path, so a deeply nested refusal can still be keyed — it just
 * stops being checked. Stopping at `never` would make those keys unspellable.
 *
 * AN ARRAY INDEXES BY NUMBER rather than by its `length` and its methods, which is what
 * `keyof` over an array would otherwise hand back.
 */
export type Paths<T, Limit extends number = 5> = Limit extends 0
    ? string
    : T extends readonly (infer Item)[]
      ? `${number}` | `${number}.${Paths<Item, Down[Limit]>}`
      : T extends object
        ? {
              [Key in keyof T & string]: T[Key] extends object
                  ? Key | `${Key}.${Paths<T[Key], Down[Limit]>}`
                  : Key
          }[keyof T & string]
        : never

/**
 * A refusal's messages keyed by path, `''` for the whole value, or a bare list over a scalar.
 */
export type Issues<T> = T extends object
    ? Partial<Record<Paths<T> | '', string[]>>
    : string[]
