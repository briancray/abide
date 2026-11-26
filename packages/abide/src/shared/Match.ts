/**
 * 47.35, 47.36 — what a `table` call matches a column against, all of it JSON: a value it equals,
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
      }

/** 47.35 — the columns a `table` call matches, each by a `ColumnMatch`. */
export type Match<Row> = { [Column in keyof Row]?: ColumnMatch<Row[Column]> }
