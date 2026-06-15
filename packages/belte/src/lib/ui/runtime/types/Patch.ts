/*
A serializable change against a document path. `replace` overwrites the value at
a path; `add` inserts (into an array at an index or `-` to push, or sets an
object key); `remove` deletes it. The path is `/`-joined segments; `''` is the
document root. Being plain data is the whole point — a patch is the unit that
flows from a transition to the DOM, to persistence, and over the wire.
*/
export type Patch =
    | { op: 'replace'; path: string; value: unknown }
    | { op: 'add'; path: string; value: unknown }
    | { op: 'remove'; path: string }
