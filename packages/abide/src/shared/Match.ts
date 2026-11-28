/**
 * 47.32, 47.33 — what a `table` call matches a column against, all of it JSON: a value it equals,
 * `null` for NULL, an array of values it is one of, or comparisons it meets every one of.
 */
export type ColumnMatch<Value> =
    | Value
    | null
    | readonly (Value | null)[]
    | {
          gt?: Value | undefined
          gte?: Value | undefined
          lt?: Value | undefined
          lte?: Value | undefined
          ne?: Value | null | undefined
          like?: string | undefined
      }

/** 47.32 — the columns a `table` call matches, each by a `ColumnMatch`. */
export type Match<Row> = { [Column in keyof Row]?: ColumnMatch<Row[Column]> }
