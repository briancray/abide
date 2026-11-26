/**
 * 47.40 — a value an owner's write lands on its source rather than in the entry holding it, to what
 * writes it there: the rows a `table` call answered, written back to the table as rows.
 */
export const WRITES_THROUGH = new WeakMap<object, (next: unknown) => void>()
