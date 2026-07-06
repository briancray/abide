/*
The sentinel `bodyValueForKind` returns for the `streaming` and `binary` body kinds —
those whose handling is side-specific (the live read throws on streaming and blobs on
binary; the warm read has no synchronous equivalent), so the caller branches on it
rather than receiving a directly-usable value. A `unique symbol` so a body value can
never collide with it.
*/
export const DEFER: unique symbol = Symbol('defer')
